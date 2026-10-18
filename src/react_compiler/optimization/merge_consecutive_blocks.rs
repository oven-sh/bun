// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Merges sequences of blocks that will always execute consecutively —
//! i.e., where the predecessor always transfers control to the successor
//! (ends in a goto) and where the predecessor is the only predecessor
//! for that successor (no other way to reach the successor).
//!
//! Value/loop blocks are left alone because they cannot be merged without
//! breaking the structure of the high-level terminals that reference them.
//!
//! Analogous to TS `HIR/MergeConsecutiveBlocks.ts`.

use crate::collections::{IdBitSet, IdMap};
use crate::diagnostics::{CompilerDiagnostic, cold_invariant};
use crate::hir::cfg_utils::mark_predecessors;
use crate::hir::visitors;
use crate::hir::{
    AliasingEffect, BasicBlock, BlockId, BlockKind, Effect, FunctionId, GENERATED_SOURCE,
    HirFunction, Instruction, InstructionId, InstructionValue, Place, Terminal,
};
use crate::hir_vec;

/// Merge consecutive blocks in the function's CFG, including inner functions.
pub(crate) fn merge_consecutive_blocks(
    func: &mut HirFunction,
    functions: &mut [HirFunction],
) -> Result<(), CompilerDiagnostic> {
    let mut inner_functions = Vec::new();
    let has_stack = collect_inner_functions(func, functions, &mut inner_functions);
    for func_id in inner_functions {
        merge_blocks(&mut functions[func_id.0 as usize])?;
    }
    if !has_stack {
        return Err(crate::lowering::nested_too_deeply());
    }
    merge_blocks(func)
}

/// The functions inside `func`, each after those inside it: the order in which their blocks are merged.
/// Stops, and returns false, where there is not the stack to go deeper: nothing is merged from there on.
fn collect_inner_functions(
    func: &HirFunction,
    functions: &[HirFunction],
    inner_functions: &mut Vec<FunctionId>,
) -> bool {
    if !crate::lowering::thread_has_stack() {
        return false;
    }
    for block in func.body.blocks.values() {
        for instr_id in &block.instructions {
            if let InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } =
                &func.instructions[instr_id.0 as usize].value
            {
                let inner = &functions[lowered_func.func.0 as usize];
                if !collect_inner_functions(inner, functions, inner_functions) {
                    return false;
                }
                inner_functions.push(lowered_func.func);
            }
        }
    }
    true
}

fn merge_blocks(func: &mut HirFunction) -> Result<(), CompilerDiagnostic> {
    // Build fallthrough set
    let mut fallthrough_blocks: IdBitSet<BlockId> = IdBitSet::default();
    for block in func.body.blocks.values() {
        if let Some(ft) = visitors::terminal_fallthrough(&block.terminal) {
            fallthrough_blocks.insert(ft);
        }
    }

    let mut merged = MergedBlocks::new();

    // The first merge is of a block that can be merged as things are.
    if !(func.body.blocks.iter()).any(|(block_id, block)| {
        mergeable_pred(func, *block_id, block, &fallthrough_blocks, &merged).is_some()
    }) {
        mark_predecessors(&mut func.body);
        return Ok(());
    }

    // Collect block IDs for iteration (since we modify during iteration)
    let block_ids: Vec<BlockId> = func.body.blocks.keys().copied().collect();

    for block_id in &block_ids {
        let block = &func.body.blocks[block_id];

        let Some(pred_id) = mergeable_pred(func, *block_id, block, &fallthrough_blocks, &merged)
        else {
            continue;
        };

        // Get evaluation order from predecessor's terminal (for phi instructions)
        let eval_order = func.body.blocks[&pred_id].terminal.evaluation_order();

        // Collect phi data from the block being merged
        let mut phis = Vec::with_capacity(block.phis.len());
        for phi in &block.phis {
            let mut operands = phi.operands.values();
            let (Some(operand), None) = (operands.next(), operands.next()) else {
                return Err(cold_invariant(
                    "Found a block with a single predecessor but where a phi has multiple operands",
                    Some(format!(
                        "{} operands in bb{}",
                        phi.operands.len(),
                        block_id.0
                    )),
                    None,
                )
                .into());
            };
            phis.push((phi.place.identifier, operand.clone()));
        }
        let block_instr_ids = block.instructions.clone();
        let block_terminal = block.terminal.clone();

        // Create phi instructions and add to instruction table
        let mut new_instr_ids = Vec::new();
        for (identifier, operand) in phis {
            let lvalue = Place {
                identifier,
                effect: Effect::ConditionallyMutate,
                reactive: false,
                loc: GENERATED_SOURCE,
            };
            let instr = Instruction {
                id: eval_order,
                lvalue: lvalue.clone(),
                value: InstructionValue::LoadLocal {
                    place: operand.clone(),
                    loc: GENERATED_SOURCE,
                },
                loc: GENERATED_SOURCE,
                effects: Some(hir_vec![AliasingEffect::Alias {
                    from: operand,
                    into: lvalue,
                }]),
            };
            let instr_id = InstructionId(func.instructions.len() as u32);
            func.instructions.push(instr);
            new_instr_ids.push(instr_id);
        }

        // Apply merge to predecessor
        let pred = func.body.blocks.get_mut(&pred_id).unwrap();
        pred.instructions.extend(new_instr_ids);
        pred.instructions.extend(block_instr_ids);
        pred.terminal = block_terminal;

        merged.merge(*block_id, pred_id);
    }
    func.body
        .blocks
        .retain(|block_id, _| !merged.map.contains_key(*block_id));

    // Update phi operands for merged blocks
    for block in func.body.blocks.values_mut() {
        for phi in &mut block.phis {
            let updates: Vec<_> = phi
                .operands
                .iter()
                .filter_map(|(pred_id, operand)| {
                    let mapped = merged.get(*pred_id);
                    if mapped != *pred_id {
                        Some((*pred_id, mapped, operand.clone()))
                    } else {
                        None
                    }
                })
                .collect();
            for (old_id, new_id, operand) in updates {
                phi.operands.shift_remove(&old_id);
                phi.operands.insert(new_id, operand);
            }
        }
    }

    mark_predecessors(&mut func.body);

    // Update terminal successors (including fallthroughs) for merged blocks
    for block in func.body.blocks.values_mut() {
        visitors::map_terminal_successors(&mut block.terminal, &mut |block_id| {
            merged.get(block_id)
        });
    }
    Ok(())
}

/// The block that `block` can be merged into.
fn mergeable_pred(
    func: &HirFunction,
    block_id: BlockId,
    block: &BasicBlock,
    fallthrough_blocks: &IdBitSet<BlockId>,
    merged: &MergedBlocks,
) -> Option<BlockId> {
    if block.preds.len() != 1
        || block.kind != BlockKind::Block
        || fallthrough_blocks.contains(block_id)
    {
        return None;
    }

    let original_pred_id = *block.preds.iter().next().unwrap();
    let pred_id = merged.get(original_pred_id);

    // Check predecessor exists and ends in goto with block kind
    (func.body.blocks.get(&pred_id))
        .is_some_and(|p| matches!(p.terminal, Terminal::Goto { .. }) && p.kind == BlockKind::Block)
        .then_some(pred_id)
}

/// Tracks which blocks have been merged and into which target.
struct MergedBlocks {
    map: IdMap<BlockId, BlockId>,
}

impl MergedBlocks {
    fn new() -> Self {
        Self { map: IdMap::new() }
    }

    /// Record that `block` was merged into `into`.
    fn merge(&mut self, block: BlockId, into: BlockId) {
        let target = self.get(into);
        self.map.insert(block, target);
    }

    /// Get the id of the block that `block` has been merged into.
    /// Transitive: if A merged into B which merged into C, get(A) returns C.
    fn get(&self, block: BlockId) -> BlockId {
        let mut current = block;
        while let Some(&target) = self.map.get(current) {
            current = target;
        }
        current
    }
}
