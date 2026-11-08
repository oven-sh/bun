//! HIR control-flow-graph utilities.
//!
//! These functions operate purely on `HIR` block structure (no AST types) and
//! were originally defined in `react_compiler_lowering::hir_builder`. They are
//! used by the optimization and inference passes to renumber, prune, and
//! reorder blocks after structural changes.

use crate::collections::IdBitSet;
use crate::collections::IndexMap;
use crate::collections::IndexSet;

use super::environment::Environment;
use super::visitors::{Blocks, each_terminal_successor, terminal_fallthrough};
use super::{
    BasicBlock, BlockId, Effect, EvaluationOrder, GotoVariant, HIR, Instruction, Place,
    SourceLocation, Terminal,
};

/// The blocks that are visited from the entry, in postorder.
struct Postorder {
    blocks: Vec<BlockId>,
    /// Reached through successors.
    used: IdBitSet<BlockId>,
    /// The fallthrough of a block that is.
    used_fallthroughs: IdBitSet<BlockId>,
}

/// Visits successors in reverse order so that when the postorder list is
/// reversed, sibling edges appear in program order.
fn postorder(hir: &HIR) -> Result<Postorder, crate::diagnostics::CompilerDiagnostic> {
    let mut visited: IdBitSet<BlockId> = IdBitSet::new();
    let mut used: IdBitSet<BlockId> = IdBitSet::new();
    let mut used_fallthroughs: IdBitSet<BlockId> = IdBitSet::new();
    let mut postorder: Vec<BlockId> = Vec::with_capacity(hir.blocks.len());

    enum Step {
        Enter(BlockId, bool),
        Exit(BlockId),
    }
    let mut stack = Vec::with_capacity(32);
    stack.push(Step::Enter(hir.entry, true));
    while let Some(step) = stack.pop() {
        let (block_id, is_used) = match step {
            Step::Enter(block_id, is_used) => (block_id, is_used),
            Step::Exit(block_id) => {
                postorder.push(block_id);
                continue;
            }
        };
        let was_used = used.contains(block_id);
        let was_visited = !visited.insert(block_id);
        if is_used {
            used.insert(block_id);
        }
        if was_visited && (was_used || !is_used) {
            continue;
        }
        if !was_visited {
            stack.push(Step::Exit(block_id));
        }

        let Some(block) = hir.blocks.get(&block_id) else {
            return Err(crate::diagnostics::cold_invariant(
                "[HIRBuilder] Unexpected null block",
                Some(format!("expected block bb{} to exist", block_id.0)),
                None,
            )
            .into());
        };

        // Visit successors in reverse order so that when we reverse the
        // postorder list, sibling edges come out in program order.
        for successor in each_terminal_successor(&block.terminal) {
            stack.push(Step::Enter(successor, is_used));
        }

        // Visit fallthrough first (marking as not-yet-used) to ensure its
        // block ID is emitted in the correct position.
        if let Some(ft) = terminal_fallthrough(&block.terminal) {
            if is_used {
                used_fallthroughs.insert(ft);
            }
            stack.push(Step::Enter(ft, false));
        }
    }

    Ok(Postorder {
        blocks: postorder,
        used,
        used_fallthroughs,
    })
}

/// What becomes of a block that is only reachable as a fallthrough.
fn unreachable_block(block: &BasicBlock, preds: IndexSet<BlockId>) -> BasicBlock {
    BasicBlock {
        kind: block.kind,
        id: block.id,
        instructions: super::AstAlloc::vec(),
        terminal: Terminal::Unreachable {
            id: block.terminal.evaluation_order(),
            loc: block.terminal.loc().copied(),
        },
        preds,
        phis: super::AstAlloc::vec(),
    }
}

/// Puts the blocks reachable from the entry into reverse postorder.
///
/// Blocks not reachable through successors are removed. Blocks that are
/// only reachable as fallthroughs (not through real successor edges) are
/// replaced with empty blocks that have an Unreachable terminal.
///
/// Returns the blocks as they were ordered, those that are removed as they were.
/// Nothing is changed if it fails.
pub fn reverse_postorder_blocks(
    hir: &mut HIR,
) -> Result<IndexMap<BlockId, BasicBlock>, crate::diagnostics::CompilerDiagnostic> {
    let order = postorder(hir)?;
    let mut old = std::mem::take(&mut hir.blocks);
    for block_id in order.blocks.into_iter().rev() {
        let block = old.get_mut(&block_id).unwrap();
        if order.used.contains(block_id) {
            let left = unreachable_block(block, IndexSet::new());
            hir.blocks.insert(block_id, std::mem::replace(block, left));
        } else if order.used_fallthroughs.contains(block_id) {
            let preds = std::mem::take(&mut block.preds);
            hir.blocks.insert(block_id, unreachable_block(block, preds));
        }
        // otherwise this block is unreachable and is dropped
    }
    Ok(old)
}

/// For each block with a `For` terminal whose update block is not in the
/// blocks map, set update to None.
pub fn remove_unreachable_for_updates(hir: &mut HIR) {
    let is_gone = |(&block_id, block): (&BlockId, &BasicBlock)| match &block.terminal {
        Terminal::For {
            update: Some(update),
            ..
        } if !hir.blocks.contains_key(update) => Some(block_id),
        _ => None,
    };
    let without_update: Blocks = hir.blocks.iter().filter_map(is_gone).collect();
    for block_id in without_update {
        if let Some(Terminal::For { update, .. }) =
            hir.blocks.get_mut(&block_id).map(|it| &mut it.terminal)
        {
            *update = None;
        }
    }
}

/// For each block with a `DoWhile` terminal whose test block is not in
/// the blocks map, replace the terminal with a Goto to the loop block.
pub fn remove_dead_do_while_statements(hir: &mut HIR) {
    let is_dead = |(&block_id, block): (&BlockId, &BasicBlock)| match &block.terminal {
        Terminal::DoWhile { test, .. } if !hir.blocks.contains_key(test) => Some(block_id),
        _ => None,
    };
    let dead: Blocks = hir.blocks.iter().filter_map(is_dead).collect();
    for block_id in dead {
        let Some(block) = hir.blocks.get_mut(&block_id) else {
            continue;
        };
        if let Terminal::DoWhile {
            loop_block,
            id,
            loc,
            ..
        } = block.terminal
        {
            block.terminal = Terminal::Goto {
                block: loop_block,
                variant: GotoVariant::Break,
                id,
                loc,
            };
        }
    }
}

/// For each block with a `Try` terminal whose handler block is not in
/// the blocks map, replace the terminal with a Goto to the try block.
///
/// Also cleans up the fallthrough block's predecessors if the handler
/// was the only path to it.
pub fn remove_unnecessary_try_catch(hir: &mut HIR) {
    // Collect the blocks that need replacement and their associated data
    let replacements: Vec<(BlockId, BlockId, BlockId, BlockId, Option<SourceLocation>)> = hir
        .blocks
        .iter()
        .filter_map(|(&block_id, block)| {
            if let Terminal::Try {
                block: try_block,
                handler,
                fallthrough,
                loc,
                ..
            } = &block.terminal
            {
                if !hir.blocks.contains_key(handler) {
                    return Some((block_id, *try_block, *handler, *fallthrough, *loc));
                }
            }
            None
        })
        .collect();

    for (block_id, try_block, handler_id, fallthrough_id, loc) in replacements {
        // Replace the terminal
        if let Some(block) = hir.blocks.get_mut(&block_id) {
            block.terminal = Terminal::Goto {
                block: try_block,
                id: EvaluationOrder(0),
                loc,
                variant: GotoVariant::Break,
            };
        }

        // Clean up fallthrough predecessor info
        if let Some(fallthrough) = hir.blocks.get_mut(&fallthrough_id) {
            if fallthrough.preds.len() == 1 && fallthrough.preds.contains(&handler_id) {
                // The handler was the only predecessor: remove the fallthrough block
                hir.blocks.shift_remove(&fallthrough_id);
            } else {
                fallthrough.preds.shift_remove(&handler_id);
            }
        }
    }
}

/// Sequentially number all instructions and terminals starting from 1.
pub fn mark_instruction_ids(hir: &mut HIR, instructions: &mut [Instruction]) {
    let mut order: u32 = 0;
    for block in hir.blocks.values_mut() {
        for &instr_id in &block.instructions {
            order += 1;
            instructions[instr_id.0 as usize].id = EvaluationOrder(order);
        }
        order += 1;
        block.terminal.set_evaluation_order(EvaluationOrder(order));
    }
}

/// DFS from entry, for each successor add the predecessor's id to
/// the successor's preds set.
///
/// Note: This only visits direct successors (via `each_terminal_successor`),
/// not fallthrough blocks. Fallthrough blocks are reached indirectly via
/// Goto terminals from within branching blocks, matching the TypeScript
/// `markPredecessors` behavior.
pub fn mark_predecessors(hir: &mut HIR) {
    // Clear all preds first
    for block in hir.blocks.values_mut() {
        block.preds.clear();
    }

    let mut stack = Vec::with_capacity(32);
    stack.push((hir.entry, None));
    while let Some((block_id, prev_block_id)) = stack.pop() {
        let Some(block) = hir.blocks.get_mut(&block_id) else {
            continue;
        };
        if let Some(prev_id) = prev_block_id {
            // Each visit but the first of the entry leaves a predecessor.
            let was_visited = block_id == hir.entry || !block.preds.is_empty();
            block.preds.insert(prev_id);
            if was_visited {
                continue;
            }
        }

        let successors = each_terminal_successor(&block.terminal);
        for successor in successors.into_iter().rev() {
            stack.push((successor, Some(block_id)));
        }
    }
}

/// Create a temporary Place with a fresh identifier allocated in the arena.
pub fn create_temporary_place(env: &mut Environment, loc: Option<SourceLocation>) -> Place {
    let id = env.next_identifier_id();
    // Update the loc on the allocated identifier
    env.identifiers[id.0 as usize].loc = loc;
    Place {
        identifier: id,
        reactive: false,
        effect: Effect::Unknown,
        loc: None,
    }
}
