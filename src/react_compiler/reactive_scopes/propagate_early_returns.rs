// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! PropagateEarlyReturns — ensures reactive blocks honor early return semantics.
//!
//! When a scope contains an early return, creates a sentinel-based check so that
//! cached scopes can properly replay the early return behavior.
//!
//! Corresponds to `src/ReactiveScopes/PropagateEarlyReturns.ts`.

use smallvec::SmallVec;

use crate::collections::IdMap;
use crate::hir::{
    BlockId, DeclarationId, Effect, EvaluationOrder, IdentifierId, InstructionKind,
    InstructionValue, LValue, NonLocalBinding, NonLocalKind, Place, ReactiveFunction,
    ReactiveInstruction, ReactiveLabel, ReactiveScopeBlock, ReactiveScopeDeclaration,
    ReactiveScopeEarlyReturn, ReactiveStatement, ReactiveTerminal, ReactiveTerminalStatement,
    ReactiveTerminalTargetKind, ReactiveValue, ScopeId, StoreStr,
    environment::{Environment, OutputMode},
    visitors,
};

use crate::reactive_scopes::visitors::{
    ReactiveFunctionTransform, Transformed, transform_reactive_function,
};

// =============================================================================
// Public entry point
// =============================================================================

/// Propagate early return semantics through reactive scopes.
/// TS: `propagateEarlyReturns`
/// Not in upstream: `last_usage`, which the merge pass returns, and the error.
pub(crate) fn propagate_early_returns(
    func: &mut ReactiveFunction,
    env: &mut Environment,
    last_usage: IdMap<DeclarationId, EvaluationOrder>,
) -> Result<(), crate::diagnostics::CompilerError> {
    let mut transform = Transform {
        env,
        last_usage,
        memo_blocks: SmallVec::new(),
    };
    let mut state = State {
        within_reactive_scope: false,
        early_return_value: None,
    };
    transform_reactive_function(func, &mut transform, &mut state)
}

// =============================================================================
// State
// =============================================================================

#[derive(Debug, Clone)]
struct EarlyReturnInfo {
    value: IdentifierId,
    loc: Option<crate::diagnostics::SourceLocation>,
    label: BlockId,
}

struct State {
    within_reactive_scope: bool,
    early_return_value: Option<EarlyReturnInfo>,
}

// =============================================================================
// Transform implementation (ReactiveFunctionTransform)
// =============================================================================

/// TS: `class Transform extends ReactiveFunctionTransform<State>`
struct Transform<'a> {
    env: &'a mut Environment,
    /// Not in upstream: where each variable is last used, from the merge pass.
    last_usage: IdMap<DeclarationId, EvaluationOrder>,
    /// Not in upstream: the memo blocks around the visited instruction, for client output only.
    memo_blocks: SmallVec<[ScopeId; 4]>,
}

impl Transform<'_> {
    /// Not in upstream (facebook/react#37540): a memo block declares its locals that are used after it.
    fn declare_used_after_memo_blocks(
        &mut self,
        value: &InstructionValue,
    ) -> Result<(), crate::diagnostics::CompilerError> {
        let kind = match value {
            InstructionValue::DeclareLocal { lvalue, .. }
            | InstructionValue::DeclareContext { lvalue, .. }
            | InstructionValue::StoreLocal { lvalue, .. }
            | InstructionValue::StoreContext { lvalue, .. } => lvalue.kind,
            InstructionValue::Destructure { lvalue, .. } => lvalue.kind,
            _ => return Ok(()),
        };
        // The store after a hoisted declaration is what declares the variable.
        if kind == InstructionKind::Reassign || kind.unhoisted().is_some() {
            return Ok(());
        }
        let (scopes, identifiers) = (&mut self.env.scopes, &self.env.identifiers);
        for place in visitors::value_lvalues(value) {
            let identifier = place.identifier;
            let declaration_id = identifiers[identifier.0 as usize].declaration_id;
            let Some(&last_used_at) = self.last_usage.get(declaration_id) else {
                continue;
            };
            for &scope_id in &self.memo_blocks {
                let scope = &mut scopes[scope_id.0 as usize];
                if last_used_at < scope.range.end
                    || (scope.declarations.iter()).any(|(_, declared)| {
                        identifiers[declared.identifier.0 as usize].declaration_id == declaration_id
                    })
                {
                    continue;
                }
                if kind == InstructionKind::Function {
                    // As a declaration it would not assign the `let` (facebook/react#37834).
                    return Err(crate::diagnostics::cold_todo(
                        "[PropagateEarlyReturns] Declare a function outside its memo block",
                        place.loc,
                    ));
                }
                let declaration = ReactiveScopeDeclaration {
                    identifier,
                    scope: scope_id,
                };
                scope.declarations.push((identifier, declaration));
            }
        }
        Ok(())
    }
}

impl<'a> ReactiveFunctionTransform for Transform<'a> {
    type State = State;

    fn env(&self) -> &Environment {
        self.env
    }

    /// TS: `override visitScope`
    fn visit_scope(
        &mut self,
        scope_block: &mut ReactiveScopeBlock,
        parent_state: &mut State,
    ) -> Result<(), crate::diagnostics::CompilerError> {
        let scope_id = scope_block.scope;

        // Exit early if an earlier pass has already created an early return
        if self.env.scopes[scope_id.0 as usize]
            .early_return_value
            .is_some()
        {
            return Ok(());
        }

        let mut inner_state = State {
            within_reactive_scope: true,
            early_return_value: parent_state.early_return_value.clone(),
        };
        let is_memo_block = self.env.output_mode == OutputMode::Client;
        if is_memo_block {
            self.memo_blocks.push(scope_id);
        }
        self.traverse_scope(scope_block, &mut inner_state)?;
        if is_memo_block {
            self.memo_blocks.pop();
        }

        if let Some(early_return_value) = inner_state.early_return_value {
            if !parent_state.within_reactive_scope {
                // This is the outermost scope wrapping an early return
                apply_early_return_to_scope(scope_block, self.env, &early_return_value);
            } else {
                // Not outermost — bubble up
                parent_state.early_return_value = Some(early_return_value);
            }
        }

        Ok(())
    }

    fn visit_instruction(
        &mut self,
        instruction: &mut ReactiveInstruction,
        state: &mut State,
    ) -> Result<(), crate::diagnostics::CompilerError> {
        if !self.memo_blocks.is_empty()
            && let ReactiveValue::Instruction(value) = &instruction.value
        {
            self.declare_used_after_memo_blocks(value)?;
        }
        self.traverse_instruction(instruction, state)
    }

    /// TS: `override transformTerminal`
    fn transform_terminal(
        &mut self,
        stmt: &mut ReactiveTerminalStatement,
        state: &mut State,
    ) -> Result<Transformed<ReactiveStatement>, crate::diagnostics::CompilerError> {
        if state.within_reactive_scope {
            if let ReactiveTerminal::Return { value, .. } = &stmt.terminal {
                let loc = value.loc;

                let early_return_value = if let Some(ref existing) = state.early_return_value {
                    existing.clone()
                } else {
                    // Create a new early return identifier
                    let identifier_id = create_temporary_place_id(self.env, loc);
                    self.env.promote_temporary(identifier_id);
                    let label = self.env.next_block_id();
                    EarlyReturnInfo {
                        value: identifier_id,
                        loc,
                        label,
                    }
                };

                state.early_return_value = Some(early_return_value.clone());

                let return_value = value.clone();

                return Ok(Transformed::ReplaceMany(vec![
                    // StoreLocal: reassign the early return value
                    ReactiveStatement::Instruction(ReactiveInstruction {
                        id: EvaluationOrder(0),
                        lvalue: None,
                        value: ReactiveValue::Instruction(InstructionValue::StoreLocal {
                            lvalue: LValue {
                                kind: InstructionKind::Reassign,
                                place: Place {
                                    identifier: early_return_value.value,
                                    effect: Effect::Capture,
                                    reactive: true,
                                    loc,
                                },
                            },
                            value: return_value,
                            type_annotation: None,
                            loc,
                        }),
                        effects: None,
                        loc,
                    }),
                    // Break to the label
                    ReactiveStatement::Terminal(ReactiveTerminalStatement {
                        terminal: ReactiveTerminal::Break {
                            target: early_return_value.label,
                            id: EvaluationOrder(0),
                            target_kind: ReactiveTerminalTargetKind::Labeled,
                            loc,
                        },
                        label: None,
                    }),
                ]));
            }
        }

        // Default: traverse into the terminal's sub-blocks
        self.visit_terminal(stmt, state)?;
        Ok(Transformed::Keep)
    }
}

// =============================================================================
// Apply early return transformation to the outermost scope
// =============================================================================

fn apply_early_return_to_scope(
    scope_block: &mut ReactiveScopeBlock,
    env: &mut Environment,
    early_return: &EarlyReturnInfo,
) {
    let scope_id = scope_block.scope;
    let loc = early_return.loc;

    // Set early return value on the scope
    env.scopes[scope_id.0 as usize].early_return_value = Some(ReactiveScopeEarlyReturn {
        value: early_return.value,
        loc: early_return.loc,
        label: early_return.label,
    });

    // Add the early return identifier as a scope declaration
    env.scopes[scope_id.0 as usize].declarations.push((
        early_return.value,
        ReactiveScopeDeclaration {
            identifier: early_return.value,
            scope: scope_id,
        },
    ));

    let sentinel_temp = create_temporary_place_id(env, loc);

    let original_instructions = std::mem::take(&mut scope_block.instructions);

    scope_block.instructions = vec![
        ReactiveStatement::Instruction(ReactiveInstruction {
            id: EvaluationOrder(0),
            lvalue: Some(Place {
                identifier: sentinel_temp,
                effect: Effect::Unknown,
                reactive: false,
                loc: None, // GeneratedSource
            }),
            value: ReactiveValue::Instruction(InstructionValue::LoadGlobal {
                binding: NonLocalBinding {
                    ref_: bun_ast::Ref::NONE,
                    kind: NonLocalKind::ModuleLocal {
                        name: StoreStr::new(b"$rc_early"),
                    },
                },
                loc,
            }),
            effects: None,
            loc,
        }),
        // StoreLocal: let earlyReturnValue = sentinel
        ReactiveStatement::Instruction(ReactiveInstruction {
            id: EvaluationOrder(0),
            lvalue: None,
            value: ReactiveValue::Instruction(InstructionValue::StoreLocal {
                lvalue: LValue {
                    kind: InstructionKind::Let,
                    place: Place {
                        identifier: early_return.value,
                        effect: Effect::ConditionallyMutate,
                        reactive: true,
                        loc,
                    },
                },
                value: Place {
                    identifier: sentinel_temp,
                    effect: Effect::Unknown,
                    reactive: false,
                    loc: None, // GeneratedSource
                },
                type_annotation: None,
                loc,
            }),
            effects: None,
            loc,
        }),
        // Label terminal wrapping the original instructions
        ReactiveStatement::Terminal(ReactiveTerminalStatement {
            label: Some(ReactiveLabel {
                id: early_return.label,
                implicit: false,
            }),
            terminal: ReactiveTerminal::Label {
                block: original_instructions,
                id: EvaluationOrder(0),
                loc: None, // GeneratedSource
            },
        }),
    ];
}

// =============================================================================
// Helper: create a temporary place identifier
// =============================================================================

fn create_temporary_place_id(
    env: &mut Environment,
    loc: Option<crate::diagnostics::SourceLocation>,
) -> IdentifierId {
    let id = env.next_identifier_id();
    env.identifiers[id.0 as usize].loc = loc;
    id
}
