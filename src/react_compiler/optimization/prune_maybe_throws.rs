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

use crate::hir::cfg_utils::{
    get_reverse_postordered_blocks, mark_instruction_ids, mark_predecessors,
    remove_dead_do_while_statements, remove_unnecessary_try_catch, remove_unreachable_for_updates,
};
use crate::hir::environment::Environment;
use crate::hir::{HirFunction, Instruction, InstructionValue, Terminal};

use crate::optimization::merge_consecutive_blocks::merge_consecutive_blocks;
use crate::ssa::eliminate_redundant_phi;

/// Prune `MaybeThrow` terminals for blocks that cannot throw, then clean up the CFG.
pub(crate) fn prune_maybe_throws(func: &mut HirFunction, env: &mut Environment) {
    if !prune_maybe_throws_impl(func) {
        return;
    }
    // If terminals have changed then blocks may have become newly unreachable.
    // Re-run minification of the graph (incl reordering instruction ids).
    func.body.blocks = get_reverse_postordered_blocks(&func.body, &func.instructions);
    remove_unreachable_for_updates(&mut func.body);
    remove_dead_do_while_statements(&mut func.body);
    remove_unnecessary_try_catch(&mut func.body);
    mark_instruction_ids(&mut func.body, &mut func.instructions);
    mark_predecessors(&mut func.body);

    // Now that predecessors are updated, prune phi operands that can never be reached.
    // The TS version re-keys such an operand through a map from each continuation to
    // the block before it. The map dates from when this pass turned `MaybeThrow` into
    // `Goto` and the continuation merged into that block. Blocks keep their ids now, so
    // an operand whose predecessor is gone is for an edge that no longer exists.
    let mut pruned_phi_operands = false;
    for block in func.body.blocks.values_mut() {
        for phi in &mut block.phis {
            let operand_count = phi.operands.len();
            phi.operands
                .retain(|pred, _operand| block.preds.contains(pred));
            pruned_phi_operands |= phi.operands.len() != operand_count;
        }
    }

    // By removing some phi operands, there may be phis that were not previously
    // redundant but now are
    if pruned_phi_operands {
        eliminate_redundant_phi(func, env);
    }

    // Finally, merge together any blocks that are now guaranteed to execute
    // consecutively
    merge_consecutive_blocks(func, &mut env.functions);
}

fn prune_maybe_throws_impl(func: &mut HirFunction) -> bool {
    let mut has_changes = false;
    let instructions = &func.instructions;

    for block in func.body.blocks.values_mut() {
        let Terminal::MaybeThrow { handler, .. } = &mut block.terminal else {
            continue;
        };

        let can_throw = block
            .instructions
            .iter()
            .any(|instr_id| instruction_may_throw(&instructions[instr_id.0 as usize]));

        if !can_throw {
            // Null out the handler rather than replacing with Goto.
            // Preserving the MaybeThrow makes the continuations clear for
            // BuildReactiveFunction, while nulling out the handler tells us
            // that control cannot flow to the handler.
            *handler = None;
            has_changes = true;
        }
    }

    has_changes
}

fn instruction_may_throw(instr: &Instruction) -> bool {
    match &instr.value {
        InstructionValue::Primitive { .. }
        | InstructionValue::ArrayExpression { .. }
        | InstructionValue::ObjectExpression { .. } => false,
        _ => true,
    }
}
