// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Builds reactive scope terminals in the HIR.
//!
//! Given a function whose reactive scope ranges have been correctly aligned and
//! merged, this pass rewrites blocks to introduce ReactiveScopeTerminals and
//! their fallthrough blocks.
//!
//! Ported from TypeScript `src/HIR/BuildReactiveScopeTerminalsHIR.ts`.

use crate::collections::IdBitSet;
use crate::collections::IdMap;
use crate::collections::IndexMap;
use crate::collections::IndexSet;
use crate::collections::sort_slice_by;
use crate::hir::AstAlloc;
use crate::hir::BasicBlock;
use crate::hir::BlockId;
use crate::hir::EvaluationOrder;
use crate::hir::GotoVariant;
use crate::hir::HirFunction;
use crate::hir::Place;
use crate::hir::ScopeId;
use crate::hir::Terminal;
use crate::hir::cfg_utils::mark_instruction_ids;
use crate::hir::cfg_utils::mark_predecessors;
use crate::hir::cfg_utils::reverse_postorder_blocks;
use crate::hir::environment::Environment;
use crate::hir::visitors::lvalues;
use crate::hir::visitors::operands;
use crate::hir::visitors::terminal_operands;

// =============================================================================
// getScopes
// =============================================================================

/// Collect all unique scopes from places in the function that have non-empty ranges,
/// each where it is met first: the order of the TS `Set`.
/// Corresponds to TS `getScopes(fn)`.
fn get_scopes(func: &HirFunction, env: &Environment) -> Vec<ScopeId> {
    let mut scope_ids: Vec<ScopeId> = Vec::new();
    let mut seen: IdBitSet<ScopeId> = IdBitSet::new();

    let mut visit_place = |place: &Place| {
        if let Some(scope_id) = env.identifiers[place.identifier.0 as usize].scope {
            let range = &env.scopes[scope_id.0 as usize].range;
            if range.start != range.end && seen.insert(scope_id) {
                scope_ids.push(scope_id);
            }
        }
    };

    for (_block_id, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            lvalues(instr).for_each(&mut visit_place);
            operands(&instr.value, &env.functions).for_each(&mut visit_place);
        }
        terminal_operands(&block.terminal).for_each(&mut visit_place);
    }

    scope_ids
}

// =============================================================================
// TerminalRewriteInfo
// =============================================================================

enum TerminalRewriteInfo {
    StartScope {
        block_id: BlockId,
        fallthrough_id: BlockId,
        instr_id: EvaluationOrder,
        scope_id: ScopeId,
    },
    EndScope {
        instr_id: EvaluationOrder,
        fallthrough_id: BlockId,
    },
}

impl TerminalRewriteInfo {
    fn instr_id(&self) -> EvaluationOrder {
        match self {
            TerminalRewriteInfo::StartScope { instr_id, .. } => *instr_id,
            TerminalRewriteInfo::EndScope { instr_id, .. } => *instr_id,
        }
    }
}

// =============================================================================
// collectScopeRewrites
// =============================================================================

/// Collect all scope rewrites by traversing scopes in pre-order.
fn collect_scope_rewrites(
    func: &HirFunction,
    env: &mut Environment,
) -> Result<Vec<TerminalRewriteInfo>, crate::diagnostics::CompilerDiagnostic> {
    let scope_ids = get_scopes(func, env);

    // Sort: ascending by start, descending by end for ties. Scopes with one range stay as
    // they were met, as `Array.prototype.sort` leaves them.
    let mut items: Vec<ScopeId> = scope_ids;
    sort_slice_by(&mut items, |a, b| {
        let a_range = &env.scopes[a.0 as usize].range;
        let b_range = &env.scopes[b.0 as usize].range;
        let start_diff = a_range.start.0.cmp(&b_range.start.0);
        if start_diff != std::cmp::Ordering::Equal {
            return start_diff;
        }
        b_range.end.0.cmp(&a_range.end.0)
    });

    let mut rewrites: Vec<TerminalRewriteInfo> = Vec::new();
    let mut fallthroughs: IdMap<ScopeId, BlockId> = IdMap::new();
    let mut active_items: Vec<ScopeId> = Vec::new();

    for i in 0..items.len() {
        let curr = items[i];
        let curr_start = env.scopes[curr.0 as usize].range.start;
        let curr_end = env.scopes[curr.0 as usize].range.end;

        // Pop active items that are disjoint with current
        let mut j = active_items.len();
        while j > 0 {
            j -= 1;
            let maybe_parent = active_items[j];
            let parent_end = env.scopes[maybe_parent.0 as usize].range.end;
            let disjoint = curr_start >= parent_end;
            let nested = curr_end <= parent_end;
            crate::diagnostics::invariant(
                disjoint || nested,
                "Invalid nesting in program blocks or scopes",
            )?;
            if disjoint {
                // Exit this scope
                let fallthrough_id = *fallthroughs.get(maybe_parent).ok_or_else(|| {
                    crate::diagnostics::cold_invariant("Expected scope to exist", None, None)
                })?;
                let end_instr_id = env.scopes[maybe_parent.0 as usize].range.end;
                rewrites.push(TerminalRewriteInfo::EndScope {
                    instr_id: end_instr_id,
                    fallthrough_id,
                });
                active_items.truncate(j);
            } else {
                break;
            }
        }

        // Enter scope
        let block_id = env.next_block_id();
        let fallthrough_id = env.next_block_id();
        let start_instr_id = env.scopes[curr.0 as usize].range.start;
        rewrites.push(TerminalRewriteInfo::StartScope {
            block_id,
            fallthrough_id,
            instr_id: start_instr_id,
            scope_id: curr,
        });
        fallthroughs.insert(curr, fallthrough_id);
        active_items.push(curr);
    }

    // Exit remaining active items
    while let Some(curr) = active_items.pop() {
        let fallthrough_id = *fallthroughs.get(curr).ok_or_else(|| {
            crate::diagnostics::cold_invariant("Expected scope to exist", None, None)
        })?;
        let end_instr_id = env.scopes[curr.0 as usize].range.end;
        rewrites.push(TerminalRewriteInfo::EndScope {
            instr_id: end_instr_id,
            fallthrough_id,
        });
    }

    Ok(rewrites)
}

// =============================================================================
// handleRewrite
// =============================================================================

struct RewriteContext {
    next_block_id: BlockId,
    /// `None`: those of the source block.
    next_pred: Option<BlockId>,
    instr_slice_idx: usize,
    rewrites: Vec<BasicBlock>,
}

fn handle_rewrite(
    terminal_info: &TerminalRewriteInfo,
    idx: usize,
    source_block: &mut BasicBlock,
    context: &mut RewriteContext,
) {
    let terminal: Terminal = match terminal_info {
        TerminalRewriteInfo::StartScope {
            block_id,
            fallthrough_id,
            instr_id,
            scope_id,
        } => Terminal::Scope {
            fallthrough: *fallthrough_id,
            block: *block_id,
            scope: *scope_id,
            id: *instr_id,
            loc: None,
        },
        TerminalRewriteInfo::EndScope {
            instr_id,
            fallthrough_id,
        } => Terminal::Goto {
            variant: GotoVariant::Break,
            block: *fallthrough_id,
            id: *instr_id,
            loc: None,
        },
    };

    let curr_block_id = context.next_block_id;
    let preds = match context.next_pred {
        Some(pred) => IndexSet::from([pred]),
        None => std::mem::take(&mut source_block.preds),
    };

    context.rewrites.push(BasicBlock {
        kind: source_block.kind,
        id: curr_block_id,
        instructions: AstAlloc::vec_from_slice(
            &source_block.instructions[context.instr_slice_idx..idx],
        ),
        preds,
        // Only the first rewrite should reuse source block phis
        phis: AstAlloc::take(&mut source_block.phis),
        terminal,
    });

    context.next_pred = Some(curr_block_id);
    context.next_block_id = match terminal_info {
        TerminalRewriteInfo::StartScope { block_id, .. } => *block_id,
        TerminalRewriteInfo::EndScope { fallthrough_id, .. } => *fallthrough_id,
    };
    context.instr_slice_idx = idx;
}

// =============================================================================
// Public API
// =============================================================================

/// Builds reactive scope terminals in the HIR.
///
/// This pass assumes that all program blocks are properly nested with respect
/// to fallthroughs. Given a function whose reactive scope ranges have been
/// correctly aligned and merged, this pass rewrites blocks to introduce
/// ReactiveScopeTerminals and their fallthrough blocks.
pub(crate) fn build_reactive_scope_terminals_hir(
    func: &mut HirFunction,
    env: &mut Environment,
) -> Result<(), crate::diagnostics::CompilerDiagnostic> {
    // Step 1: Collect rewrites
    let mut queued_rewrites = collect_scope_rewrites(func, env)?;

    // Step 2: Apply rewrites by splitting blocks
    let mut rewritten_final_blocks: IdMap<BlockId, BlockId> = IdMap::new();
    let mut next_blocks: IndexMap<BlockId, BasicBlock> = IndexMap::new();

    // Reverse so we can pop from the end while traversing in ascending order
    queued_rewrites.reverse();

    for (_block_id, mut block) in std::mem::take(&mut func.body.blocks) {
        let mut context = RewriteContext {
            next_block_id: block.id,
            rewrites: Vec::new(),
            next_pred: None,
            instr_slice_idx: 0,
        };

        // Handle queued terminal rewrites at their nearest instruction ID
        for i in 0..block.instructions.len() + 1 {
            let instr_id = if i < block.instructions.len() {
                let instr_idx = block.instructions[i];
                func.instructions[instr_idx.0 as usize].id
            } else {
                block.terminal.evaluation_order()
            };

            while let Some(rewrite) = queued_rewrites.last() {
                if rewrite.instr_id() <= instr_id {
                    // Need to pop before calling handle_rewrite
                    let rewrite = queued_rewrites.pop().unwrap();
                    handle_rewrite(&rewrite, i, &mut block, &mut context);
                } else {
                    break;
                }
            }
        }

        if let Some(final_pred) = context.next_pred {
            let final_block = BasicBlock {
                id: context.next_block_id,
                kind: block.kind,
                preds: IndexSet::from([final_pred]),
                terminal: block.terminal,
                instructions: AstAlloc::vec_from_slice(
                    &block.instructions[context.instr_slice_idx..],
                ),
                phis: AstAlloc::vec(),
            };
            let final_block_id = final_block.id;
            context.rewrites.push(final_block);
            for b in context.rewrites {
                next_blocks.insert(b.id, b);
            }
            rewritten_final_blocks.insert(block.id, final_block_id);
        } else {
            next_blocks.insert(block.id, block);
        }
    }

    func.body.blocks = next_blocks;

    // Step 3: Repoint phis when they refer to a rewritten block
    for block in func.body.blocks.values_mut() {
        for phi in &mut block.phis {
            let updates: Vec<(BlockId, BlockId)> = phi
                .operands
                .keys()
                .filter_map(|original_id| {
                    rewritten_final_blocks
                        .get(*original_id)
                        .map(|new_id| (*original_id, *new_id))
                })
                .collect();
            for (old_id, new_id) in updates {
                if let Some(value) = phi.operands.shift_remove(&old_id) {
                    phi.operands.insert(new_id, value);
                }
            }
        }
    }

    // Step 4: Fixup HIR to restore RPO, correct predecessors, renumber instructions
    reverse_postorder_blocks(&mut func.body)?;
    mark_predecessors(&mut func.body);
    mark_instruction_ids(&mut func.body, &mut func.instructions);

    // Step 5: Fix scope and identifier ranges to account for renumbered instructions
    fix_scope_and_identifier_ranges(func, env);
    Ok(())
}

/// Fix scope ranges after instruction renumbering.
/// Scope ranges should always align to start at the 'scope' terminal
/// and end at the first instruction of the fallthrough block.
///
/// In TS, `identifier.mutableRange` and `scope.range` are the same object
/// reference (after InferReactiveScopeVariables). When scope.range is updated,
/// all identifiers with that scope automatically see the new range.
/// BUT: after MergeOverlappingReactiveScopesHIR, repointed identifiers have
/// mutableRange pointing to the OLD scope's range, NOT the root scope's range.
/// So only identifiers whose mutableRange matches their scope's pre-renumbering
/// range should be updated.
///
/// Corresponds to TS `fixScopeAndIdentifierRanges`.
fn fix_scope_and_identifier_ranges(func: &HirFunction, env: &mut Environment) {
    for (_block_id, block) in &func.body.blocks {
        match &block.terminal {
            Terminal::Scope {
                fallthrough,
                scope,
                id,
                ..
            }
            | Terminal::PrunedScope {
                fallthrough,
                scope,
                id,
                ..
            } => {
                let fallthrough_block = func.body.blocks.get(fallthrough).unwrap();
                let first_id = if !fallthrough_block.instructions.is_empty() {
                    func.instructions[fallthrough_block.instructions[0].0 as usize].id
                } else {
                    fallthrough_block.terminal.evaluation_order()
                };
                env.scopes[scope.0 as usize].range.start = *id;
                env.scopes[scope.0 as usize].range.end = first_id;
            }
            _ => {}
        }
    }

    // Sync identifier mutable ranges with their scope ranges, but ONLY
    // for identifiers whose mutableRange has the same identity as their
    // scope's range, which the updates above have not changed. In TS,
    // identifier.mutableRange and scope.range are only the same JS object
    // for identifiers that were the canonical representative when the scope
    // was created. After MergeOverlappingReactiveScopesHIR, repointed
    // identifiers have mutableRange pointing to the OLD scope's range,
    // not the root scope's range — so they should NOT be synced here.
    for ident in &mut env.identifiers {
        if let Some(scope_id) = ident.scope {
            let scope_range = &env.scopes[scope_id.0 as usize].range;
            if ident.mutable_range.same_range(scope_range) {
                ident.mutable_range.start = scope_range.start;
                ident.mutable_range.end = scope_range.end;
            }
        }
    }
}
