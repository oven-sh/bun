// Copyright (c) Meta Platforms, Inc. and affiliates.
//
// This source code is licensed under the MIT license found in the
// LICENSE file in the root directory of this source tree.

//! Validates that useEffect is not used for derived computations which could/should
//! be performed in render.
//!
//! See https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state
//!
//! Port of ValidateNoDerivedComputationsInEffects.ts.

use std::collections::{HashMap, HashSet};

use crate::diagnostics::{CompilerError, CompilerErrorDetail, ErrorCategory};
use crate::hir::environment::Environment;
use crate::hir::{
    ArrayElement, BlockId, FunctionId, HirFunction, Identifier, IdentifierId, InstructionValue,
    PlaceOrSpread, SourceLocation, Type, is_set_state_type, is_use_effect_hook_type,
};

/// Records errors directly on the Environment (matching TS `env.recordError()` behavior).
pub(crate) fn validate_no_derived_computations_in_effects(
    func: &HirFunction,
    env: &mut Environment,
) -> Result<(), CompilerError> {
    // Phase 1: Collect effect call sites (func_id + resolved deps).
    // Done with only immutable borrows of env fields.
    let effects_to_validate: Vec<(FunctionId, Vec<IdentifierId>)> = {
        let ids = &env.identifiers;
        let tys = &env.types;
        let mut candidate_deps: HashMap<IdentifierId, Vec<IdentifierId>> = HashMap::new();
        let mut functions_map: HashMap<IdentifierId, FunctionId> = HashMap::new();
        let mut locals_map: HashMap<IdentifierId, IdentifierId> = HashMap::new();
        let mut result = Vec::new();

        for (_, block) in &func.body.blocks {
            for &iid in &block.instructions {
                let instr = &func.instructions[iid.0 as usize];
                match &instr.value {
                    InstructionValue::LoadLocal { place, .. } => {
                        locals_map.insert(instr.lvalue.identifier, place.identifier);
                    }
                    InstructionValue::ArrayExpression { elements, .. } => {
                        let elem_ids: Vec<IdentifierId> = elements
                            .iter()
                            .filter_map(|e| match e {
                                ArrayElement::Place(p) => Some(p.identifier),
                                _ => None,
                            })
                            .collect();
                        if elem_ids.len() == elements.len() {
                            candidate_deps.insert(instr.lvalue.identifier, elem_ids);
                        }
                    }
                    InstructionValue::FunctionExpression { lowered_func, .. } => {
                        functions_map.insert(instr.lvalue.identifier, lowered_func.func);
                    }
                    InstructionValue::CallExpression { callee, args, .. } => {
                        let callee_ty = &tys[ids[callee.identifier.0 as usize].type_.0 as usize];
                        if is_use_effect_hook_type(callee_ty) && args.len() == 2 {
                            if let (PlaceOrSpread::Place(arg0), PlaceOrSpread::Place(arg1)) =
                                (&args[0], &args[1])
                            {
                                if let (Some(&func_id), Some(dep_elements)) = (
                                    functions_map.get(&arg0.identifier),
                                    candidate_deps.get(&arg1.identifier),
                                ) {
                                    if !dep_elements.is_empty() {
                                        let resolved: Vec<IdentifierId> = dep_elements
                                            .iter()
                                            .map(|d| locals_map.get(d).copied().unwrap_or(*d))
                                            .collect();
                                        result.push((func_id, resolved));
                                    }
                                }
                            }
                        }
                    }
                    InstructionValue::MethodCall { property, args, .. } => {
                        let callee_ty = &tys[ids[property.identifier.0 as usize].type_.0 as usize];
                        if is_use_effect_hook_type(callee_ty) && args.len() == 2 {
                            if let (PlaceOrSpread::Place(arg0), PlaceOrSpread::Place(arg1)) =
                                (&args[0], &args[1])
                            {
                                if let (Some(&func_id), Some(dep_elements)) = (
                                    functions_map.get(&arg0.identifier),
                                    candidate_deps.get(&arg1.identifier),
                                ) {
                                    if !dep_elements.is_empty() {
                                        let resolved: Vec<IdentifierId> = dep_elements
                                            .iter()
                                            .map(|d| locals_map.get(d).copied().unwrap_or(*d))
                                            .collect();
                                        result.push((func_id, resolved));
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
        result
    };

    // Phase 2: Validate each collected effect and record error details.
    // Uses ErrorDetail (flat loc format) to match TS behavior where
    // env.recordError(new CompilerErrorDetail({...})) is used.
    for (func_id, resolved_deps) in effects_to_validate {
        let details = validate_effect(
            &env.functions[func_id.0 as usize],
            &resolved_deps,
            &env.identifiers,
            &env.types,
        );
        for detail in details {
            env.record_error(detail)?;
        }
    }
    Ok(())
}

fn validate_effect(
    effect_func: &HirFunction,
    effect_deps: &[IdentifierId],
    ids: &[Identifier],
    tys: &[Type],
) -> Vec<CompilerErrorDetail> {
    // Check that the effect function only captures effect deps and setState
    for ctx in &effect_func.context {
        let ctx_ty = &tys[ids[ctx.identifier.0 as usize].type_.0 as usize];
        if is_set_state_type(ctx_ty) {
            continue;
        } else if effect_deps.iter().any(|d| *d == ctx.identifier) {
            continue;
        } else {
            return Vec::new();
        }
    }

    // Check that all effect deps are actually used in the function
    for dep in effect_deps {
        if !effect_func.context.iter().any(|c| c.identifier == *dep) {
            return Vec::new();
        }
    }

    let mut seen_blocks: HashSet<BlockId> = HashSet::new();
    let mut dep_values: HashMap<IdentifierId, Vec<IdentifierId>> = HashMap::new();
    for dep in effect_deps {
        dep_values.insert(*dep, vec![*dep]);
    }

    let mut set_state_locs: Vec<SourceLocation> = Vec::new();

    for (_, block) in &effect_func.body.blocks {
        for &pred in &block.preds {
            if !seen_blocks.contains(&pred) {
                return Vec::new();
            }
        }

        for phi in &block.phis {
            let mut aggregate: HashSet<IdentifierId> = HashSet::new();
            for operand in phi.operands.values() {
                if let Some(deps) = dep_values.get(&operand.identifier) {
                    for d in deps {
                        aggregate.insert(*d);
                    }
                }
            }
            if !aggregate.is_empty() {
                dep_values.insert(phi.place.identifier, aggregate.into_iter().collect());
            }
        }

        for &iid in &block.instructions {
            let instr = &effect_func.instructions[iid.0 as usize];
            match &instr.value {
                InstructionValue::Primitive { .. }
                | InstructionValue::JSXText { .. }
                | InstructionValue::LoadGlobal { .. } => {}
                InstructionValue::LoadLocal { place, .. } => {
                    if let Some(deps) = dep_values.get(&place.identifier) {
                        dep_values.insert(instr.lvalue.identifier, deps.clone());
                    }
                }
                InstructionValue::ComputedLoad { .. }
                | InstructionValue::PropertyLoad { .. }
                | InstructionValue::BinaryExpression { .. }
                | InstructionValue::TemplateLiteral { .. }
                | InstructionValue::CallExpression { .. }
                | InstructionValue::MethodCall { .. } => {
                    let mut aggregate: HashSet<IdentifierId> = HashSet::new();
                    for operand in value_operands(&instr.value) {
                        if let Some(deps) = dep_values.get(&operand) {
                            for d in deps {
                                aggregate.insert(*d);
                            }
                        }
                    }
                    if !aggregate.is_empty() {
                        dep_values.insert(instr.lvalue.identifier, aggregate.into_iter().collect());
                    }

                    if let InstructionValue::CallExpression { callee, args, .. } = &instr.value {
                        let callee_ty = &tys[ids[callee.identifier.0 as usize].type_.0 as usize];
                        if is_set_state_type(callee_ty) && args.len() == 1 {
                            if let PlaceOrSpread::Place(arg) = &args[0] {
                                if let Some(deps) = dep_values.get(&arg.identifier) {
                                    let dep_set: HashSet<_> = deps.iter().collect();
                                    if dep_set.len() == effect_deps.len() {
                                        if let Some(loc) = callee.loc {
                                            set_state_locs.push(loc);
                                        }
                                    } else {
                                        return Vec::new();
                                    }
                                } else {
                                    return Vec::new();
                                }
                            }
                        }
                    }
                }
                _ => {
                    return Vec::new();
                }
            }
        }

        match &block.terminal {
            crate::hir::Terminal::Return { value, .. }
            | crate::hir::Terminal::Throw { value, .. } => {
                if dep_values.contains_key(&value.identifier) {
                    return Vec::new();
                }
            }
            crate::hir::Terminal::If { test, .. } | crate::hir::Terminal::Branch { test, .. } => {
                if dep_values.contains_key(&test.identifier) {
                    return Vec::new();
                }
            }
            crate::hir::Terminal::Switch { test, .. } => {
                if dep_values.contains_key(&test.identifier) {
                    return Vec::new();
                }
            }
            _ => {}
        }

        seen_blocks.insert(block.id);
    }

    set_state_locs
        .into_iter()
        .map(|loc| {
            CompilerErrorDetail {
                category: ErrorCategory::EffectDerivationsOfState,
                reason: "Values derived from props and state should be calculated during render, not in an effect. (https://react.dev/learn/you-might-not-need-an-effect#updating-state-based-on-props-or-state)".to_string(),
                description: None,
                loc: Some(loc),
                suggestions: None,
            }
        })
        .collect()
}

/// Collects operand IdentifierIds for a subset of instruction variants used
/// by `validate_effect`.
///
/// NOTE: This intentionally does NOT use the canonical `each_instruction_value_operand`
/// because: (1) `validate_effect` only matches specific variants
/// (ComputedLoad, PropertyLoad, BinaryExpression, TemplateLiteral, CallExpression,
/// MethodCall), so FunctionExpression/ObjectMethod context handling is unnecessary;
/// and (2) the caller does not have access to `env` which the canonical function requires
/// for resolving function expression context captures.
fn value_operands(value: &InstructionValue) -> Vec<IdentifierId> {
    match value {
        InstructionValue::ComputedLoad {
            object, property, ..
        } => {
            vec![object.identifier, property.identifier]
        }
        InstructionValue::PropertyLoad { object, .. } => vec![object.identifier],
        InstructionValue::BinaryExpression { left, right, .. } => {
            vec![left.identifier, right.identifier]
        }
        InstructionValue::TemplateLiteral { subexprs, .. } => {
            subexprs.iter().map(|s| s.identifier).collect()
        }
        InstructionValue::CallExpression { callee, args, .. } => {
            let mut op_ids = vec![callee.identifier];
            for a in args {
                op_ids.push(a.place().identifier)
            }
            op_ids
        }
        InstructionValue::MethodCall {
            receiver,
            property,
            args,
            ..
        } => {
            let mut op_ids = vec![receiver.identifier, property.identifier];
            for a in args {
                op_ids.push(a.place().identifier)
            }
            op_ids
        }
        _ => Vec::new(),
    }
}
