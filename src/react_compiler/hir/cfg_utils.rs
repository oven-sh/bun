//! HIR control-flow-graph utilities.
//!
//! These functions operate purely on `HIR` block structure (no AST types) and
//! were originally defined in `react_compiler_lowering::hir_builder`. They are
//! used by the optimization and inference passes to renumber, prune, and
//! reorder blocks after structural changes.

use crate::collections::IndexMap;
use crate::collections::IndexSet;

use super::environment::Environment;
use super::visitors::{each_terminal_successor, terminal_fallthrough};
use super::{
    BasicBlock, BlockId, Effect, EvaluationOrder, GotoVariant, HIR, Instruction, Place,
    SourceLocation, Terminal,
};

/// Compute a reverse-postorder of blocks reachable from the entry.
///
/// Visits successors in reverse order so that when the postorder list is
/// reversed, sibling edges appear in program order.
///
/// Blocks not reachable through successors are removed. Blocks that are
/// only reachable as fallthroughs (not through real successor edges) are
/// replaced with empty blocks that have an Unreachable terminal.
pub fn get_reverse_postordered_blocks(
    hir: &HIR,
    _instructions: &[Instruction],
) -> IndexMap<BlockId, BasicBlock> {
    let mut visited: IndexSet<BlockId> = IndexSet::new();
    let mut used: IndexSet<BlockId> = IndexSet::new();
    let mut used_fallthroughs: IndexSet<BlockId> = IndexSet::new();
    let mut postorder: Vec<BlockId> = Vec::new();

    fn visit(
        hir: &HIR,
        block_id: BlockId,
        is_used: bool,
        visited: &mut IndexSet<BlockId>,
        used: &mut IndexSet<BlockId>,
        used_fallthroughs: &mut IndexSet<BlockId>,
        postorder: &mut Vec<BlockId>,
    ) {
        let was_used = used.contains(&block_id);
        let was_visited = visited.contains(&block_id);
        visited.insert(block_id);
        if is_used {
            used.insert(block_id);
        }
        if was_visited && (was_used || !is_used) {
            return;
        }

        let block = hir
            .blocks
            .get(&block_id)
            .unwrap_or_else(|| panic!("[HIRBuilder] expected block {:?} to exist", block_id));

        // Visit successors in reverse order so that when we reverse the
        // postorder list, sibling edges come out in program order.
        let mut successors = each_terminal_successor(&block.terminal);
        successors.reverse();

        let fallthrough = terminal_fallthrough(&block.terminal);

        // Visit fallthrough first (marking as not-yet-used) to ensure its
        // block ID is emitted in the correct position.
        if let Some(ft) = fallthrough {
            if is_used {
                used_fallthroughs.insert(ft);
            }
            visit(hir, ft, false, visited, used, used_fallthroughs, postorder);
        }
        for successor in successors {
            visit(
                hir,
                successor,
                is_used,
                visited,
                used,
                used_fallthroughs,
                postorder,
            );
        }

        if !was_visited {
            postorder.push(block_id);
        }
    }

    visit(
        hir,
        hir.entry,
        true,
        &mut visited,
        &mut used,
        &mut used_fallthroughs,
        &mut postorder,
    );

    let mut blocks = IndexMap::new();
    for block_id in postorder.into_iter().rev() {
        let block = hir.blocks.get(&block_id).unwrap();
        if used.contains(&block_id) {
            blocks.insert(block_id, block.clone());
        } else if used_fallthroughs.contains(&block_id) {
            blocks.insert(
                block_id,
                BasicBlock {
                    kind: block.kind,
                    id: block_id,
                    instructions: super::AstAlloc::vec(),
                    terminal: Terminal::Unreachable {
                        id: block.terminal.evaluation_order(),
                        loc: block.terminal.loc().copied(),
                    },
                    preds: block.preds.clone(),
                    phis: super::AstAlloc::vec(),
                },
            );
        }
        // otherwise this block is unreachable and is dropped
    }

    blocks
}

/// For each block with a `For` terminal whose update block is not in the
/// blocks map, set update to None.
pub fn remove_unreachable_for_updates(hir: &mut HIR) {
    let block_ids: IndexSet<BlockId> = hir.blocks.keys().copied().collect();
    for block in hir.blocks.values_mut() {
        if let Terminal::For { update, .. } = &mut block.terminal {
            if let Some(update_id) = *update {
                if !block_ids.contains(&update_id) {
                    *update = None;
                }
            }
        }
    }
}

/// For each block with a `DoWhile` terminal whose test block is not in
/// the blocks map, replace the terminal with a Goto to the loop block.
pub fn remove_dead_do_while_statements(hir: &mut HIR) {
    let block_ids: IndexSet<BlockId> = hir.blocks.keys().copied().collect();
    for block in hir.blocks.values_mut() {
        let should_replace = if let Terminal::DoWhile { test, .. } = &block.terminal {
            !block_ids.contains(test)
        } else {
            false
        };
        if should_replace {
            if let Terminal::DoWhile {
                loop_block,
                id,
                loc,
                ..
            } = std::mem::replace(
                &mut block.terminal,
                Terminal::Unreachable {
                    id: EvaluationOrder(0),
                    loc: None,
                },
            ) {
                block.terminal = Terminal::Goto {
                    block: loop_block,
                    variant: GotoVariant::Break,
                    id,
                    loc,
                };
            }
        }
    }
}

/// For each block with a `Try` terminal whose handler block is not in
/// the blocks map, replace the terminal with a Goto to the try block.
///
/// Also cleans up the fallthrough block's predecessors if the handler
/// was the only path to it.
pub fn remove_unnecessary_try_catch(hir: &mut HIR) {
    let block_ids: IndexSet<BlockId> = hir.blocks.keys().copied().collect();

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
                if !block_ids.contains(handler) {
                    return Some((block_id, *try_block, *handler, *fallthrough, loc.clone()));
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

    let mut visited: IndexSet<BlockId> = IndexSet::new();

    fn visit(
        hir: &mut HIR,
        block_id: BlockId,
        prev_block_id: Option<BlockId>,
        visited: &mut IndexSet<BlockId>,
    ) {
        // Add predecessor
        if let Some(prev_id) = prev_block_id {
            if let Some(block) = hir.blocks.get_mut(&block_id) {
                block.preds.insert(prev_id);
            } else {
                return;
            }
        }

        if visited.contains(&block_id) {
            return;
        }
        visited.insert(block_id);

        // Get successors before mutating
        let successors = if let Some(block) = hir.blocks.get(&block_id) {
            each_terminal_successor(&block.terminal)
        } else {
            return;
        };

        for successor in successors {
            visit(hir, successor, Some(block_id), visited);
        }
    }

    visit(hir, hir.entry, None, &mut visited);
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
