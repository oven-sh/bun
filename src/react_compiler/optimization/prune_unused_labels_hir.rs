// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Removes unused labels from the HIR.
//!
//! A label terminal whose body block immediately breaks to the label's
//! fallthrough (with no other predecessors) is effectively a no-op label.
//! This pass merges such label/body/fallthrough triples into a single block.
//!
//! Analogous to TS `PruneUnusedLabelsHIR.ts`.

use crate::collections::{IdBitSet, IdMap};
use crate::hir::{BlockId, BlockKind, GotoVariant, HirFunction, Terminal};

pub(crate) fn prune_unused_labels_hir(
    func: &mut HirFunction,
) -> Result<(), crate::diagnostics::CompilerDiagnostic> {
    // Phase 1: Identify label terminals whose body block immediately breaks
    // to the fallthrough, and both body and fallthrough are normal blocks.
    let mut merged: Vec<(BlockId, BlockId, BlockId)> = Vec::new(); // (label, next, fallthrough)

    for (&block_id, block) in &func.body.blocks {
        if let Terminal::Label {
            block: next_id,
            fallthrough: fallthrough_id,
            ..
        } = &block.terminal
        {
            let next = &func.body.blocks[next_id];
            let fallthrough = &func.body.blocks[fallthrough_id];
            if let Terminal::Goto {
                block: goto_target,
                variant: GotoVariant::Break,
                ..
            } = &next.terminal
            {
                if goto_target == fallthrough_id
                    && next.kind == BlockKind::Block
                    && fallthrough.kind == BlockKind::Block
                {
                    merged.push((block_id, *next_id, *fallthrough_id));
                }
            }
        }
    }

    // Not in upstream. Without a merge there is nothing to rewrite either.
    if merged.is_empty() {
        return Ok(());
    }

    // Phase 2: Apply merges
    let mut rewrites: IdMap<BlockId, BlockId> = IdMap::new();
    // Not in upstream, which removes each block at once: that moves every later block of the map.
    let mut removed: IdBitSet<BlockId> = IdBitSet::new();

    for (original_label_id, next_id, fallthrough_id) in &merged {
        let label_id = rewrites
            .get(*original_label_id)
            .copied()
            .unwrap_or(*original_label_id);
        // Upstream's lookups below fail for a block that an earlier merge removed.
        debug_assert!(!removed.contains(*next_id) && !removed.contains(*fallthrough_id));

        // Validate: no phis in next or fallthrough
        let next_phis_empty = func.body.blocks[next_id].phis.is_empty();
        let fallthrough_phis_empty = func.body.blocks[fallthrough_id].phis.is_empty();
        crate::diagnostics::invariant(
            next_phis_empty && fallthrough_phis_empty,
            "Unexpected phis when merging label blocks",
        )?;

        // Validate: single predecessors
        let next_preds_ok = func.body.blocks[next_id].preds.len() == 1
            && func.body.blocks[next_id].preds.contains(original_label_id);
        let fallthrough_preds_ok = func.body.blocks[fallthrough_id].preds.len() == 1
            && func.body.blocks[fallthrough_id].preds.contains(next_id);
        crate::diagnostics::invariant(
            next_preds_ok && fallthrough_preds_ok,
            "Unexpected block predecessors when merging label blocks",
        )?;

        // Collect instructions from next and fallthrough
        let next_instructions = func.body.blocks[next_id].instructions.clone();
        let fallthrough_instructions = func.body.blocks[fallthrough_id].instructions.clone();
        let fallthrough_terminal = func.body.blocks[fallthrough_id].terminal.clone();

        // Merge into the label block
        let label_block = func.body.blocks.get_mut(&label_id).unwrap();
        label_block.instructions.extend(next_instructions);
        label_block.instructions.extend(fallthrough_instructions);
        label_block.terminal = fallthrough_terminal;

        // Remove merged blocks
        removed.insert(*next_id);
        removed.insert(*fallthrough_id);

        rewrites.insert(*fallthrough_id, label_id);
    }
    func.body
        .blocks
        .retain(|block_id, _| !removed.contains(*block_id));
    // No block that others were merged into was merged away itself. Phase 3 relies on it.
    debug_assert!(rewrites.values().all(|label| !removed.contains(*label)));

    // Phase 3: Rewrite predecessor sets
    for block in func.body.blocks.values_mut() {
        let preds_to_rewrite: Vec<(BlockId, BlockId)> = block
            .preds
            .iter()
            .filter_map(|pred| rewrites.get(*pred).map(|rewritten| (*pred, *rewritten)))
            .collect();
        // Not in upstream, which removes each one before it adds its rewrite: that moves every later predecessor.
        if !preds_to_rewrite.is_empty() {
            block.preds.retain(|pred| !rewrites.contains_key(*pred));
        }
        for (_, new) in preds_to_rewrite {
            block.preds.insert(new);
        }
    }
    // The rewrite leaves the predecessors that `mark_predecessors` computes, in another order.
    #[cfg(debug_assertions)]
    {
        let mut marked = func.body.clone();
        crate::hir::cfg_utils::mark_predecessors(&mut marked);
        for (block, expected) in func.body.blocks.values().zip(marked.blocks.values()) {
            debug_assert!(
                block.preds.len() == expected.preds.len()
                    && block.preds.iter().all(|pred| expected.preds.contains(pred)),
                "bb{}: {:?} is not {:?}",
                block.id.0,
                block.preds,
                expected.preds,
            );
        }
    }
    Ok(())
}
