// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Optimizes the code for running in an SSR environment.
//!
//! Assumes a single render: effects and the event handlers of builtin JSX tags never run.
//!
//! Optimizations:
//! - Inline useState/useReducer when nothing that is kept reads the setter or dispatch function
//! - Remove effects (useEffect, useLayoutEffect, useInsertionEffect)
//! - Remove known event handler props and ref props from builtin JSX tags
//! - Inline useEffectEvent to its argument
//!
//! Ported from TypeScript `src/Optimization/OptimizeForSSR.ts`.
//! Unlike upstream, a function that calls setState is never replaced with `undefined`.

use std::collections::HashMap;

use super::dead_code_elimination::{find_referenced_identifiers, is_id_or_name_used};
use crate::hir::environment::Environment;
use crate::hir::object_shape::HookKind;
use crate::hir::visitors::{each_instruction_value_operand, each_terminal_operand};
use crate::hir::{
    ArrayPatternElement, HirFunction, IdentifierId, InstructionValue, PlaceOrSpread,
    PrimitiveValue, hir_vec,
};

/// Optimizes a function for SSR by inlining state hooks, removing effects,
/// and stripping known event handler / ref JSX props.
///
/// Corresponds to TS `optimizeForSSR(fn: HIRFunction): void`.
pub(crate) fn optimize_for_ssr(func: &mut HirFunction, env: &Environment) {
    // Phase 1: Identify useState/useReducer calls that can be safely inlined.
    //
    // For useState(initialValue) where initialValue is primitive/object/array,
    // store a LoadLocal of the initial value.
    //
    // For useReducer(reducer, initialArg) store a LoadLocal of initialArg.
    // For useReducer(reducer, initialArg, init) store a CallExpression of init(initialArg).
    //
    // Any use of the hook return other than the expected destructuring pattern
    // prevents inlining (we delete from inlined_state if we see the identifier used
    // as an operand elsewhere).
    let mut inlined_state: HashMap<IdentifierId, InlinedStateReplacement> = HashMap::new();

    for (_block_id, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::Destructure { value, lvalue, .. } => {
                    if inlined_state.contains_key(&env.identifiers[value.identifier.0 as usize].id)
                    {
                        if let crate::hir::Pattern::Array(arr) = &lvalue.pattern {
                            if !arr.items.is_empty() {
                                if let ArrayPatternElement::Place(_) = &arr.items[0] {
                                    // Allow destructuring of inlined states
                                    continue;
                                }
                            }
                        }
                    }
                }
                InstructionValue::MethodCall { property, args, .. }
                | InstructionValue::CallExpression {
                    callee: property,
                    args,
                    ..
                } => {
                    // Determine callee based on instruction kind
                    let callee_id = property.identifier;
                    let hook_kind = get_hook_kind(env, callee_id);
                    match hook_kind {
                        Some(HookKind::UseReducer) => {
                            if args.len() == 2 {
                                if let (PlaceOrSpread::Place(_), PlaceOrSpread::Place(arg)) =
                                    (&args[0], &args[1])
                                {
                                    let lvalue_id =
                                        env.identifiers[instr.lvalue.identifier.0 as usize].id;
                                    inlined_state.insert(
                                        lvalue_id,
                                        InlinedStateReplacement::LoadLocal {
                                            place: arg.clone(),
                                            loc: arg.loc,
                                        },
                                    );
                                }
                            } else if args.len() == 3 {
                                if let (
                                    PlaceOrSpread::Place(_),
                                    PlaceOrSpread::Place(arg),
                                    PlaceOrSpread::Place(initializer),
                                ) = (&args[0], &args[1], &args[2])
                                {
                                    let lvalue_id =
                                        env.identifiers[instr.lvalue.identifier.0 as usize].id;
                                    let call_loc = instr.value.loc().copied();
                                    inlined_state.insert(
                                        lvalue_id,
                                        InlinedStateReplacement::CallExpression {
                                            callee: initializer.clone(),
                                            arg: arg.clone(),
                                            loc: call_loc,
                                        },
                                    );
                                }
                            }
                        }
                        Some(HookKind::UseState) => {
                            if args.len() == 1 {
                                if let PlaceOrSpread::Place(arg) = &args[0] {
                                    let arg_type = &env.types[env.identifiers
                                        [arg.identifier.0 as usize]
                                        .type_
                                        .0
                                        as usize];
                                    if crate::hir::is_primitive_type(arg_type)
                                        || crate::hir::is_plain_object_type(arg_type)
                                        || crate::hir::is_array_type(arg_type)
                                    {
                                        let lvalue_id =
                                            env.identifiers[instr.lvalue.identifier.0 as usize].id;
                                        inlined_state.insert(
                                            lvalue_id,
                                            InlinedStateReplacement::LoadLocal {
                                                place: arg.clone(),
                                                loc: arg.loc,
                                            },
                                        );
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }

            // Any use of useState/useReducer return besides destructuring prevents inlining
            if !inlined_state.is_empty() {
                let operands = each_instruction_value_operand(&instr.value, env);
                for operand in &operands {
                    let id = env.identifiers[operand.identifier.0 as usize].id;
                    inlined_state.remove(&id);
                }
            }
        }
        if !inlined_state.is_empty() {
            let operands = each_terminal_operand(&block.terminal);
            for operand in &operands {
                let id = env.identifiers[operand.identifier.0 as usize].id;
                inlined_state.remove(&id);
            }
        }
    }

    // Phase 2: Remove what a server render never runs
    //
    // - Remove known event handler props and ref props from builtin JSX tags
    // - Replace useEffectEvent(fn) with LoadLocal(fn)
    // - Replace useEffect/useLayoutEffect/useInsertionEffect with Primitive(undefined)
    for (_block_id, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &mut func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::JsxExpression { tag, .. } => {
                    if let crate::hir::JsxTag::Builtin(builtin) = tag {
                        // Only optimize non-custom-element builtin tags
                        if !bun_core::strings::contains_char(&builtin.name, b'-') {
                            let tag_name = builtin.name;
                            // Retain only props that are not known event handlers and not "ref"
                            if let InstructionValue::JsxExpression { props, .. } = &mut instr.value
                            {
                                props.retain(|prop| match prop {
                                    crate::hir::JsxAttribute::SpreadAttribute { .. } => true,
                                    crate::hir::JsxAttribute::Attribute { name, .. } => {
                                        !is_known_event_handler(&tag_name, name) && *name != b"ref"
                                    }
                                });
                            }
                        }
                    }
                }
                InstructionValue::MethodCall {
                    property,
                    args,
                    loc,
                    ..
                }
                | InstructionValue::CallExpression {
                    callee: property,
                    args,
                    loc,
                    ..
                } => {
                    let callee_id = property.identifier;
                    let hook_kind = get_hook_kind(env, callee_id);
                    match hook_kind {
                        Some(HookKind::UseEffectEvent) => {
                            if args.len() == 1 {
                                if let PlaceOrSpread::Place(arg) = &args[0] {
                                    let loc = *loc;
                                    instr.value = InstructionValue::LoadLocal {
                                        place: arg.clone(),
                                        loc,
                                    };
                                }
                            }
                        }
                        Some(
                            HookKind::UseEffect
                            | HookKind::UseLayoutEffect
                            | HookKind::UseInsertionEffect,
                        ) => {
                            let loc = *loc;
                            instr.value = InstructionValue::Primitive {
                                value: PrimitiveValue::Undefined,
                                loc,
                            };
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }

    if inlined_state.is_empty() {
        return;
    }

    // Phase 3: Inlining drops the setter's declaration, so keep a hook if DCE keeps a read of it
    let referenced = find_referenced_identifiers(func, env);
    // DCE prunes a hook call with an unread result, but not the `init(arg)` call that would replace it
    inlined_state.retain(|id, _| is_id_or_name_used(&referenced, &env.identifiers, *id));
    for (_block_id, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &func.instructions[instr_id.0 as usize];
            if let InstructionValue::Destructure { value, lvalue, .. } = &instr.value {
                let value_id = env.identifiers[value.identifier.0 as usize].id;
                if !inlined_state.contains_key(&value_id) {
                    continue;
                }
                let crate::hir::Pattern::Array(arr) = &lvalue.pattern else {
                    continue;
                };
                let is_rest_used = arr.items.iter().skip(1).any(|item| match item {
                    ArrayPatternElement::Place(place) => {
                        is_id_or_name_used(&referenced, &env.identifiers, place.identifier)
                    }
                    ArrayPatternElement::Spread(spread) => {
                        is_id_or_name_used(&referenced, &env.identifiers, spread.place.identifier)
                    }
                    ArrayPatternElement::Hole => false,
                });
                if is_rest_used {
                    inlined_state.remove(&value_id);
                }
            }
        }
    }

    // Phase 4: Inline the hooks that are left
    for (_block_id, block) in &func.body.blocks {
        for &instr_id in &block.instructions {
            let instr = &mut func.instructions[instr_id.0 as usize];
            match &instr.value {
                InstructionValue::Destructure { value, lvalue, loc } => {
                    let value_id = env.identifiers[value.identifier.0 as usize].id;
                    if inlined_state.contains_key(&value_id) {
                        // Invariant: destructuring pattern must be ArrayPattern with at least one Identifier item
                        if let crate::hir::Pattern::Array(arr) = &lvalue.pattern {
                            if !arr.items.is_empty() {
                                if let ArrayPatternElement::Place(first_place) = &arr.items[0] {
                                    let loc = *loc;
                                    let kind = lvalue.kind;
                                    let store = InstructionValue::StoreLocal {
                                        lvalue: crate::hir::LValue {
                                            place: first_place.clone(),
                                            kind,
                                        },
                                        value: value.clone(),
                                        type_annotation: None,
                                        loc,
                                    };
                                    instr.value = store;
                                }
                            }
                        }
                    }
                }
                InstructionValue::MethodCall { property, .. }
                | InstructionValue::CallExpression {
                    callee: property, ..
                } => {
                    let callee_id = property.identifier;
                    let hook_kind = get_hook_kind(env, callee_id);
                    match hook_kind {
                        Some(HookKind::UseReducer | HookKind::UseState) => {
                            let lvalue_id = env.identifiers[instr.lvalue.identifier.0 as usize].id;
                            if let Some(replacement) = inlined_state.get(&lvalue_id) {
                                instr.value = match replacement {
                                    InlinedStateReplacement::LoadLocal { place, loc } => {
                                        InstructionValue::LoadLocal {
                                            place: place.clone(),
                                            loc: *loc,
                                        }
                                    }
                                    InlinedStateReplacement::CallExpression {
                                        callee,
                                        arg,
                                        loc,
                                    } => InstructionValue::CallExpression {
                                        callee: callee.clone(),
                                        args: hir_vec![PlaceOrSpread::Place(arg.clone())],
                                        loc: *loc,
                                    },
                                };
                            }
                        }
                        _ => {}
                    }
                }
                _ => {}
            }
        }
    }
}

/// Replacement values for inlined useState/useReducer calls.
#[derive(Debug, Clone)]
enum InlinedStateReplacement {
    /// Replace with `LoadLocal { place }` — used for useState and useReducer(reducer, initialArg)
    LoadLocal {
        place: crate::hir::Place,
        loc: Option<crate::hir::SourceLocation>,
    },
    /// Replace with `CallExpression { callee, args: [arg] }` — used for useReducer(reducer, initialArg, init)
    CallExpression {
        callee: crate::hir::Place,
        arg: crate::hir::Place,
        loc: Option<crate::hir::SourceLocation>,
    },
}

/// Returns true if the prop name matches the known event handler pattern `on[A-Z]`.
fn is_known_event_handler(_tag: &[u8], prop: &[u8]) -> bool {
    if prop.len() < 3 {
        return false;
    }
    if !prop.starts_with(b"on") {
        return false;
    }
    prop[2].is_ascii_uppercase()
}

/// Get the hook kind for an identifier, if its type represents a hook.
fn get_hook_kind(env: &Environment, identifier_id: IdentifierId) -> Option<HookKind> {
    env.get_hook_kind_for_id(identifier_id)
        .ok()
        .flatten()
        .cloned()
}
