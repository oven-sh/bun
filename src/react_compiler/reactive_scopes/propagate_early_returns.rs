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

use crate::hir::{
    BlockId, Effect, EvaluationOrder, IdentifierId, IdentifierName, InstructionKind,
    InstructionValue, LValue, NonLocalBinding, NonLocalKind, Place, ReactiveFunction,
    ReactiveInstruction, ReactiveLabel, ReactiveScopeBlock, ReactiveScopeDeclaration,
    ReactiveScopeEarlyReturn, ReactiveStatement, ReactiveTerminal, ReactiveTerminalStatement,
    ReactiveTerminalTargetKind, ReactiveValue, StoreStr, environment::Environment,
};

use crate::reactive_scopes::visitors::{
    ReactiveFunctionTransform, Transformed, transform_reactive_function,
};

// =============================================================================
// Public entry point
// =============================================================================

/// Propagate early return semantics through reactive scopes.
/// TS: `propagateEarlyReturns`
pub fn propagate_early_returns(func: &mut ReactiveFunction, env: &mut Environment) {
    let mut transform = Transform { env };
    let mut state = State {
        within_reactive_scope: false,
        early_return_value: None,
    };
    // The TS version doesn't produce errors from this pass, so we ignore the Result.
    let _ = transform_reactive_function(func, &mut transform, &mut state);
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
        self.traverse_scope(scope_block, &mut inner_state)?;

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
                    promote_temporary(self.env, identifier_id);
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

fn promote_temporary(env: &mut Environment, identifier_id: IdentifierId) {
    let decl_id = env.identifiers[identifier_id.0 as usize].declaration_id;
    env.identifiers[identifier_id.0 as usize].name = Some(promoted_name(b't', decl_id.0));
}

fn promoted_name(kind: u8, n: u32) -> IdentifierName {
    let mut itoa = bun_core::fmt::ItoaBuf::new();
    let digits = itoa.format(n).as_bytes();
    let mut buf = [0u8; 16];
    buf[0] = b'#';
    buf[1] = kind;
    buf[2..2 + digits.len()].copy_from_slice(digits);
    IdentifierName::Promoted(StoreStr::new(bun_ast::data_store_dupe_str(
        &buf[..2 + digits.len()],
    )))
}
