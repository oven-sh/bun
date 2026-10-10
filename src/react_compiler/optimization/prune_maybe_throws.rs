// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Prunes `MaybeThrow` terminals for blocks that can provably never throw.
//!
//! Currently very conservative: only affects blocks with primitives or
//! array/object literals. Even a variable reference could throw due to TDZ.
//!
//! Analogous to TS `Optimization/PruneMaybeThrows.ts`.

use crate::collections::IdMap;
use crate::diagnostics::{CompilerDiagnostic, CompilerError, cold_invariant};
use crate::hir::cfg_utils::{
    get_reverse_postordered_blocks, mark_instruction_ids, remove_dead_do_while_statements,
    remove_unnecessary_try_catch, remove_unreachable_for_updates,
};
use crate::hir::{BlockId, HirFunction, Instruction, InstructionValue, Terminal};

use crate::optimization::merge_consecutive_blocks::merge_consecutive_blocks;

/// Prune `MaybeThrow` terminals for blocks that cannot throw, then clean up the CFG.
pub(crate) fn prune_maybe_throws(
    func: &mut HirFunction,
    functions: &mut [HirFunction],
) -> Result<(), CompilerDiagnostic> {
    let terminal_mapping = prune_maybe_throws_impl(func);
    if let Some(terminal_mapping) = terminal_mapping {
        // If terminals have changed then blocks may have become newly unreachable.
        // Re-run minification of the graph (incl reordering instruction ids).
        func.body.blocks = get_reverse_postordered_blocks(&func.body, &func.instructions);
        remove_unreachable_for_updates(&mut func.body);
        remove_dead_do_while_statements(&mut func.body);
        remove_unnecessary_try_catch(&mut func.body);
        mark_instruction_ids(&mut func.body, &mut func.instructions);
        // Not in upstream, which finds the phi operand of a removed catch block
        // in the rewrite below. That is too late here: the merge asserts on
        // such a phi, and the rewrite can move the operand onto another removed
        // block, which can make InferReactivePlaces panic.
        for block in func.body.blocks.values() {
            for phi in &block.phis {
                for predecessor in phi.operands.keys() {
                    if !func.body.blocks.contains_key(predecessor) {
                        return Err(unmapped_predecessor(*predecessor, block.id).into());
                    }
                }
            }
        }
        merge_consecutive_blocks(func, functions);

        // Rewrite phi operands to reference the updated predecessor blocks
        for block in func.body.blocks.values_mut() {
            let preds = &block.preds;
            let mut phi_updates: Vec<(usize, Vec<(BlockId, BlockId)>)> = Vec::new();

            for (phi_idx, phi) in block.phis.iter().enumerate() {
                let mut updates = Vec::new();
                for (predecessor, _) in &phi.operands {
                    if !preds.contains(predecessor) {
                        let mapped_terminal = terminal_mapping
                            .get(*predecessor)
                            .copied()
                            .ok_or_else(|| unmapped_predecessor(*predecessor, block.id))?;
                        updates.push((*predecessor, mapped_terminal));
                    }
                }
                if !updates.is_empty() {
                    phi_updates.push((phi_idx, updates));
                }
            }

            for (phi_idx, updates) in phi_updates {
                for (old_pred, new_pred) in updates {
                    let operand = block.phis[phi_idx]
                        .operands
                        .shift_remove(&old_pred)
                        .unwrap();
                    block.phis[phi_idx].operands.insert(new_pred, operand);
                }
            }
        }
    }
    Ok(())
}

#[cold]
fn unmapped_predecessor(predecessor: BlockId, block: BlockId) -> CompilerError {
    cold_invariant(
        "Expected non-existing phi operand's predecessor to have been mapped to a new terminal",
        Some(format!(
            "Could not find mapping for predecessor bb{} in block bb{}",
            predecessor.0, block.0,
        )),
        None,
    )
}

fn prune_maybe_throws_impl(func: &mut HirFunction) -> Option<IdMap<BlockId, BlockId>> {
    let mut terminal_mapping: IdMap<BlockId, BlockId> = IdMap::new();
    let mut pruned_edges: Vec<(BlockId, BlockId)> = Vec::new();
    let instructions = &func.instructions;

    for block in func.body.blocks.values_mut() {
        let continuation = match &block.terminal {
            Terminal::MaybeThrow { continuation, .. } => *continuation,
            _ => continue,
        };

        let can_throw = block
            .instructions
            .iter()
            .any(|instr_id| instruction_may_throw(&instructions[instr_id.0 as usize]));

        if !can_throw {
            let source = terminal_mapping.get(block.id).copied().unwrap_or(block.id);
            terminal_mapping.insert(continuation, source);
            // Null out the handler rather than replacing with Goto.
            // Preserving the MaybeThrow makes the continuations clear for
            // BuildReactiveFunction, while nulling out the handler tells us
            // that control cannot flow to the handler.
            if let Terminal::MaybeThrow { handler, .. } = &mut block.terminal {
                if let Some(handler) = *handler {
                    pruned_edges.push((block.id, handler));
                }
                *handler = None;
            }
        }
    }

    // Not in upstream: a pruned block is no longer a predecessor of its handler,
    // so the phis of the handler drop its operand. Upstream keeps the operand,
    // and the rewrite in `prune_maybe_throws` raises its invariant for it:
    // `terminal_mapping` has no predecessor of the handler to map it to.
    for (predecessor, handler) in pruned_edges {
        if let Some(handler_block) = func.body.blocks.get_mut(&handler) {
            for phi in &mut handler_block.phis {
                phi.operands.shift_remove(&predecessor);
            }
        }
    }

    if terminal_mapping.is_empty() {
        None
    } else {
        Some(terminal_mapping)
    }
}

fn instruction_may_throw(instr: &Instruction) -> bool {
    match &instr.value {
        InstructionValue::Primitive { .. }
        | InstructionValue::ArrayExpression { .. }
        | InstructionValue::ObjectExpression { .. } => false,
        _ => true,
    }
}
