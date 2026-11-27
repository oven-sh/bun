//! Not in upstream: oxc's `validate_locals_not_reassigned_after_render` as of oxlint 1.95 (oxc 8612f43be and
//! 3d3a6f468), for `EnvironmentConfig::captured_variables_can_be_updated`. Upstream's pass of that name is the other
//! file, and nothing here is to be synced with it.
//!
//! A captured variable isn't renamed by SSA. So this follows, block by block, which values a captured variable can
//! hold, and asks for a function that escapes what its captured variables hold where it escapes.

use std::collections::VecDeque;
use std::collections::hash_map::Entry;

use super::async_callable_contexts::{
    AsyncCallables, ReturnedCallables, infer_async_callable_contexts,
};
use super::validate_locals_not_reassigned_after_render::format_variable_name;
use crate::collections::{FxHashMap, FxHashSet};
use crate::diagnostics::{CompilerDiagnostic, CompilerDiagnosticDetail, ErrorCategory};
use crate::hir::environment::Environment;
use crate::hir::object_shape::FunctionSignature;
use crate::hir::type_config::{AliasingEffectConfig, AliasingSignatureConfig};
use crate::hir::visitors::{lvalues, operands, terminal_operands};
use crate::hir::{
    BlockId, Effect, HirFunction, Identifier, IdentifierId, InstructionId, InstructionKind,
    InstructionValue, Place, Terminal,
};

type ContextValues = FxHashMap<IdentifierId, FxHashSet<IdentifierId>>;
type CapturedContexts = FxHashMap<IdentifierId, FxHashSet<IdentifierId>>;
type HoistedFunctionValues = FxHashMap<IdentifierId, IdentifierId>;
type CorrelatedValues = FxHashMap<IdentifierId, Vec<(Option<BlockId>, IdentifierId)>>;
type PropagationEdges = FxHashMap<IdentifierId, Vec<IdentifierId>>;

struct ReassignmentSources<'a> {
    context_values_by_block: &'a FxHashMap<BlockId, ContextValues>,
    reassigning_functions: &'a FxHashMap<IdentifierId, Place>,
    captured_contexts: &'a CapturedContexts,
    correlated_values: &'a CorrelatedValues,
}

#[derive(Clone, Default)]
struct ReassignmentResult {
    reassignment: Option<Place>,
    returned: Option<Place>,
    returned_contexts: FxHashSet<IdentifierId>,
    returned_context_loads: FxHashSet<IdentifierId>,
    returned_callables: ReturnedCallables,
}

/// Validates that local variables cannot be reassigned after render.
/// This prevents a category of bugs in which a closure captures a
/// binding from one render but does not update.
pub(crate) fn validate_captured_reassignments(func: &HirFunction, env: &mut Environment) {
    if !has_nested_context_store(func, env, false) {
        return;
    }

    let mut context_variables: FxHashSet<IdentifierId> = FxHashSet::default();
    let mut diagnostics: Vec<CompilerDiagnostic> = Vec::new();

    for param in &func.params {
        context_variables.insert(param.place().identifier);
    }
    collect_outer_context_variables(func, &mut context_variables);

    let reassignment = get_context_reassignment(
        func,
        env,
        &mut context_variables,
        false,
        false,
        &mut diagnostics,
    )
    .reassignment;

    // Record accumulated errors (from async function checks in inner functions) first
    for diagnostic in diagnostics {
        env.record_diagnostic(diagnostic);
    }

    // Then record the top-level reassignment error if any
    if let Some(reassignment_place) = reassignment {
        let diagnostic = reassigned_after_render(&reassignment_place, &env.identifiers);
        env.record_diagnostic(diagnostic);
    }
}

/// Every reported reassignment starts at a context store or update inside a nested
/// function. Without one, the analysis below cannot report anything, so it is skipped.
fn has_nested_context_store(func: &HirFunction, env: &Environment, is_nested: bool) -> bool {
    if !env.has_stack() {
        return false;
    }
    func.instructions.iter().any(|instr| match &instr.value {
        InstructionValue::StoreContext { .. }
        | InstructionValue::PostfixUpdateContext { .. }
        | InstructionValue::PrefixUpdateContext { .. } => is_nested,
        InstructionValue::FunctionExpression { lowered_func, .. }
        | InstructionValue::ObjectMethod { lowered_func, .. } => {
            has_nested_context_store(&env.functions[lowered_func.func.0 as usize], env, true)
        }
        _ => false,
    })
}

/// Parameter patterns are lowered to temporary parameters followed by context stores.
/// Collect those stores before visiting initializer closures so later named parameters
/// are visible to closures created by earlier parameter initializers.
fn collect_outer_context_variables(
    func: &HirFunction,
    context_variables: &mut FxHashSet<IdentifierId>,
) {
    for (_, block) in &func.body.blocks {
        for &instruction_id in &block.instructions {
            match &func.instructions[instruction_id.0 as usize].value {
                InstructionValue::DeclareContext { lvalue, .. }
                | InstructionValue::StoreContext { lvalue, .. } => {
                    context_variables.insert(lvalue.place.identifier);
                }
                InstructionValue::PostfixUpdateContext { lvalue, value, .. }
                | InstructionValue::PrefixUpdateContext { lvalue, value, .. } => {
                    context_variables.insert(lvalue.identifier);
                    context_variables.insert(value.identifier);
                }
                _ => {}
            }
        }
    }
}

fn reassigned_after_render(
    reassignment_place: &Place,
    identifiers: &[Identifier],
) -> CompilerDiagnostic {
    let variable_name = format_variable_name(reassignment_place, identifiers);
    CompilerDiagnostic::new(
        ErrorCategory::Immutability,
        "Cannot reassign variable after render completes",
        Some(format!(
            "Reassigning {} after render has completed can cause inconsistent \
             behavior on subsequent renders. Consider using state instead",
            variable_name
        )),
    )
    .with_detail(CompilerDiagnosticDetail::Error {
        loc: reassignment_place.loc,
        message: Some(format!(
            "Cannot reassign {} after render completes",
            variable_name
        )),
        identifier_name: None,
    })
}

fn record_async_reassignment(
    reassignment_place: &Place,
    identifiers: &[Identifier],
    diagnostics: &mut Vec<CompilerDiagnostic>,
) {
    let variable_name = format_variable_name(reassignment_place, identifiers);
    diagnostics.push(
        CompilerDiagnostic::new(
            ErrorCategory::Immutability,
            "Cannot reassign variable in async function",
            Some(
                "Reassigning a variable in an async function can cause \
                 inconsistent behavior on subsequent renders. \
                 Consider using state instead"
                    .to_string(),
            ),
        )
        .with_detail(CompilerDiagnosticDetail::Error {
            loc: reassignment_place.loc,
            message: Some(format!("Cannot reassign {}", variable_name)),
            identifier_name: None,
        }),
    );
}

/// oxc panics here.
fn record_effects_not_inferred(diagnostics: &mut Vec<CompilerDiagnostic>) {
    diagnostics.push(
        crate::diagnostics::cold_invariant(
            "Expected effects to be inferred prior to ValidateLocalsNotReassignedAfterRender",
            None,
            None,
        )
        .into(),
    );
}

/// Operands through which a reassigning function can propagate. Calls with a
/// no-alias signature only propagate through their callee or receiver, which come first.
fn each_reassigning_operand<'a>(
    value: &'a InstructionValue,
    env: &'a Environment,
) -> impl Iterator<Item = &'a Place> {
    let checked = match value {
        InstructionValue::CallExpression { callee, .. }
        | InstructionValue::TaggedTemplateExpression { tag: callee, .. }
            if env.has_no_alias_signature(callee.identifier) =>
        {
            1
        }
        InstructionValue::MethodCall { property, .. }
            if env.has_no_alias_signature(property.identifier) =>
        {
            2
        }
        _ => usize::MAX,
    };
    operands(value, &env.functions).take(checked)
}

/// The signature of the function that `identifier` is, by its type.
pub(super) fn signature_of(
    env: &Environment,
    identifier: IdentifierId,
) -> Option<&FunctionSignature> {
    let ty = &env.types[env.identifiers[identifier.0 as usize].type_.0 as usize];
    env.get_function_signature(ty).ok().flatten()
}

/// Callback operands excluded by a no-alias signature. Mutations performed by
/// these callbacks are synchronous, but a value returned from one can still
/// contain an escaping closure.
pub(super) fn no_alias_callback_parameters(
    value: &InstructionValue,
    env: &Environment,
    require_result_flow: bool,
    argument_count: usize,
) -> Vec<usize> {
    let signature_identifier = match value {
        InstructionValue::CallExpression { callee, .. } => callee.identifier,
        InstructionValue::MethodCall { property, .. } => property.identifier,
        _ => return Vec::new(),
    };

    let Some(signature) = signature_of(env, signature_identifier) else {
        return Vec::new();
    };
    if !signature.no_alias {
        return Vec::new();
    }
    let Some(aliasing) = &signature.aliasing else {
        if require_result_flow {
            return Vec::new();
        }
        // Legacy no-alias signatures can invoke callbacks without retaining
        // their results. Read-only arguments cannot invoke a mutable callback.
        let only_first_callback = matches!(
            signature.canonical_name,
            Some(
                "Array.filter"
                    | "Array.every"
                    | "Array.some"
                    | "Array.find"
                    | "Array.findIndex"
                    | "Set.forEach"
                    | "Map.forEach"
            )
        );
        return (0..argument_count)
            .filter(|&index| {
                // These built-ins invoke only the first argument; thisArg can
                // itself be a function without ever being called.
                if only_first_callback && index != 0 {
                    return false;
                }
                let effect = signature
                    .positional_params
                    .get(index)
                    .copied()
                    .or(signature.rest_param);
                matches!(
                    effect,
                    Some(Effect::ConditionallyMutate | Effect::Capture | Effect::Store)
                )
            })
            .collect();
    };

    let mut callbacks = Vec::new();
    for effect in &aliasing.effects {
        let AliasingEffectConfig::Apply { function, into, .. } = effect else {
            continue;
        };
        if require_result_flow && !aliasing_value_flows_to_return(aliasing, *into) {
            continue;
        }
        for (index, parameter) in aliasing.params.iter().enumerate() {
            if parameter != function {
                continue;
            }
            callbacks.push(index);
        }
    }
    callbacks
}

fn aliasing_value_flows_to_return(
    aliasing: &AliasingSignatureConfig,
    source: &'static str,
) -> bool {
    let mut values: FxHashSet<&'static str> = FxHashSet::default();
    let mut pending: VecDeque<&'static str> = VecDeque::from([source]);
    while let Some(value) = pending.pop_front() {
        if value == aliasing.returns {
            return true;
        }
        if !values.insert(value) {
            continue;
        }
        for effect in &aliasing.effects {
            let edge = match effect {
                AliasingEffectConfig::CreateFrom { from, into }
                | AliasingEffectConfig::Assign { from, into }
                | AliasingEffectConfig::Alias { from, into }
                | AliasingEffectConfig::Capture { from, into }
                | AliasingEffectConfig::ImmutableCapture { from, into } => Some((*from, *into)),
                _ => None,
            };
            if let Some((from, into)) = edge
                && from == value
            {
                pending.push_back(into);
            }
        }
    }
    false
}

fn insert_context_value(
    context_values: &mut ContextValues,
    context_identifier: IdentifierId,
    value: IdentifierId,
) {
    context_values
        .entry(context_identifier)
        .or_default()
        .insert(value);
}

fn replace_context_value(
    context_values: &mut ContextValues,
    context_identifier: IdentifierId,
    value: IdentifierId,
) {
    let mut values = FxHashSet::default();
    values.insert(value);
    context_values.insert(context_identifier, values);
}

fn clear_context_value(context_values: &mut ContextValues, context_identifier: IdentifierId) {
    context_values.insert(context_identifier, FxHashSet::default());
}

fn replace_correlated_value(
    correlated_values: &mut CorrelatedValues,
    context_identifier: IdentifierId,
    value: IdentifierId,
) {
    correlated_values.insert(context_identifier, vec![(None, value)]);
}

fn clear_correlated_value(
    correlated_values: &mut CorrelatedValues,
    context_identifier: IdentifierId,
) {
    correlated_values.insert(context_identifier, Vec::new());
}

fn merge_context_values(target: &mut ContextValues, source: &ContextValues) {
    for (&context_identifier, values) in source {
        target.entry(context_identifier).or_default().extend(values);
    }
}

fn connect_context_value(
    context_values: &ContextValues,
    context_identifier: IdentifierId,
    target: IdentifierId,
    propagation_edges: &mut PropagationEdges,
) {
    if let Some(values) = context_values.get(&context_identifier) {
        for &value in values {
            propagation_edges.entry(value).or_default().push(target);
        }
    } else {
        propagation_edges
            .entry(context_identifier)
            .or_default()
            .push(target);
    }
}

fn visit_reassignment_value(
    identifier: IdentifierId,
    context_values: &ContextValues,
    context_block: Option<BlockId>,
    sources: &ReassignmentSources<'_>,
    visited: &mut FxHashSet<(IdentifierId, Option<BlockId>)>,
) -> Option<Place> {
    if !visited.insert((identifier, context_block)) {
        return None;
    }
    if let Some(place) = sources.reassigning_functions.get(&identifier) {
        return Some(place.clone());
    }
    if let Some(correlated_sources) = sources.correlated_values.get(&identifier) {
        return correlated_sources
            .iter()
            .find_map(|&(predecessor, source)| {
                let predecessor_values = predecessor
                    .and_then(|block_id| sources.context_values_by_block.get(&block_id))
                    .unwrap_or(context_values);
                visit_reassignment_value(source, predecessor_values, predecessor, sources, visited)
            });
    }
    let contexts = sources.captured_contexts.get(&identifier)?;
    contexts.iter().find_map(|&context_identifier| {
        if let Some(values) = context_values.get(&context_identifier) {
            values.iter().find_map(|&value| {
                visit_reassignment_value(value, context_values, context_block, sources, visited)
            })
        } else {
            visit_reassignment_value(
                context_identifier,
                context_values,
                context_block,
                sources,
                visited,
            )
        }
    })
}

fn find_reassignment_for_operand(
    identifier: IdentifierId,
    context_values: &ContextValues,
    sources: &ReassignmentSources<'_>,
) -> Option<Place> {
    let mut visited = FxHashSet::default();
    if let Some(values) = context_values.get(&identifier) {
        values.iter().find_map(|&value| {
            visit_reassignment_value(value, context_values, None, sources, &mut visited)
        })
    } else {
        visit_reassignment_value(identifier, context_values, None, sources, &mut visited)
    }
}

fn propagate_captured_contexts(
    captured_contexts: &mut CapturedContexts,
    propagation_edges: &PropagationEdges,
) {
    let mut pending: VecDeque<IdentifierId> = captured_contexts.keys().copied().collect();
    while let Some(identifier) = pending.pop_front() {
        let Some(contexts) = captured_contexts.get(&identifier).cloned() else {
            continue;
        };
        let Some(targets) = propagation_edges.get(&identifier) else {
            continue;
        };
        for &target in targets {
            let target_contexts = captured_contexts.entry(target).or_default();
            let previous_len = target_contexts.len();
            target_contexts.extend(contexts.iter().copied());
            if target_contexts.len() != previous_len {
                pending.push_back(target);
            }
        }
    }
}

fn propagate_correlated_values(
    correlated_values: &mut CorrelatedValues,
    propagation_edges: &PropagationEdges,
) {
    let mut pending: VecDeque<IdentifierId> = correlated_values.keys().copied().collect();
    while let Some(identifier) = pending.pop_front() {
        let Some(sources) = correlated_values.get(&identifier).cloned() else {
            continue;
        };
        let Some(targets) = propagation_edges.get(&identifier) else {
            continue;
        };
        for &target in targets {
            let target_sources = correlated_values.entry(target).or_default();
            let previous_len = target_sources.len();
            for source in &sources {
                if !target_sources.contains(source) {
                    target_sources.push(*source);
                }
            }
            if target_sources.len() != previous_len {
                pending.push_back(target);
            }
        }
    }
}

fn propagate_reassignments(
    seeds: &[(IdentifierId, Place)],
    propagation_edges: &PropagationEdges,
) -> FxHashMap<IdentifierId, Place> {
    let mut reassignments: FxHashMap<IdentifierId, Place> = FxHashMap::default();
    let mut pending: VecDeque<(IdentifierId, Place)> = VecDeque::new();
    for (identifier, reassignment_place) in seeds {
        if let Entry::Vacant(entry) = reassignments.entry(*identifier) {
            entry.insert(reassignment_place.clone());
            pending.push_back((*identifier, reassignment_place.clone()));
        }
    }
    while let Some((identifier, reassignment_place)) = pending.pop_front() {
        let Some(targets) = propagation_edges.get(&identifier) else {
            continue;
        };
        for &target in targets {
            if let Entry::Vacant(entry) = reassignments.entry(target) {
                entry.insert(reassignment_place.clone());
                pending.push_back((target, reassignment_place.clone()));
            }
        }
    }
    reassignments
}

fn context_values_at_block_entry(
    func: &HirFunction,
    block_id: BlockId,
    initial: &ContextValues,
    values_by_block: &FxHashMap<BlockId, ContextValues>,
) -> ContextValues {
    let mut values = ContextValues::default();
    if block_id == func.body.entry {
        merge_context_values(&mut values, initial);
    }
    let Some(block) = func.body.blocks.get(&block_id) else {
        return values;
    };
    for predecessor in &block.preds {
        if let Some(predecessor_values) = values_by_block.get(predecessor) {
            merge_context_values(&mut values, predecessor_values);
        }
    }
    values
}

fn correlated_context_values_at_block_entry(
    func: &HirFunction,
    block_id: BlockId,
    initial: &ContextValues,
    values_by_block: &FxHashMap<BlockId, ContextValues>,
) -> CorrelatedValues {
    let mut sources = CorrelatedValues::default();
    if block_id == func.body.entry {
        for (&context_identifier, values) in initial {
            sources
                .entry(context_identifier)
                .or_default()
                .extend(values.iter().map(|&value| (None, value)));
        }
    }
    let Some(block) = func.body.blocks.get(&block_id) else {
        return sources;
    };
    for predecessor in &block.preds {
        if let Some(predecessor_values) = values_by_block.get(predecessor) {
            for (&context_identifier, values) in predecessor_values {
                let context_sources = sources.entry(context_identifier).or_default();
                for &value in values {
                    let source = (Some(*predecessor), value);
                    if !context_sources.contains(&source) {
                        context_sources.push(source);
                    }
                }
            }
        }
    }
    sources
}

fn is_hoisted_function_store(
    value: &InstructionValue,
    hoisted_function_values: &HoistedFunctionValues,
) -> bool {
    matches!(value, InstructionValue::StoreContext { lvalue, .. }
        if lvalue.kind == InstructionKind::Function
            && hoisted_function_values.contains_key(&lvalue.place.identifier))
}

fn update_context_values(
    value: &InstructionValue,
    values: &mut ContextValues,
    hoisted_function_values: &HoistedFunctionValues,
) {
    if is_hoisted_function_store(value, hoisted_function_values) {
        return;
    }
    match value {
        InstructionValue::DeclareContext { lvalue, .. } => {
            let replacement = if lvalue.kind == InstructionKind::HoistedFunction {
                hoisted_function_values
                    .get(&lvalue.place.identifier)
                    .copied()
                    .unwrap_or(lvalue.place.identifier)
            } else {
                lvalue.place.identifier
            };
            replace_context_value(values, lvalue.place.identifier, replacement);
        }
        InstructionValue::StoreContext { lvalue, value, .. } => {
            replace_context_value(values, lvalue.place.identifier, value.identifier);
        }
        InstructionValue::PostfixUpdateContext { lvalue, .. }
        | InstructionValue::PrefixUpdateContext { lvalue, .. } => {
            clear_context_value(values, lvalue.identifier);
        }
        _ => {}
    }
}

/// Compute the possible current value of each context binding at every block exit.
/// Context bindings are not SSA-renamed, so preserving these reaching values keeps a
/// later store from tainting an earlier load while still accounting for loop backedges.
fn infer_context_values_by_block(
    func: &HirFunction,
    functions: &[HirFunction],
) -> (
    ContextValues,
    FxHashMap<BlockId, ContextValues>,
    HoistedFunctionValues,
) {
    let mut initial = ContextValues::default();
    for context_place in &func.context {
        insert_context_value(
            &mut initial,
            context_place.identifier,
            context_place.identifier,
        );
    }
    for (_, block) in &func.body.blocks {
        for &instruction_id in &block.instructions {
            let instr = &func.instructions[instruction_id.0 as usize];
            match &instr.value {
                InstructionValue::DeclareContext { lvalue, .. }
                | InstructionValue::StoreContext { lvalue, .. } => {
                    insert_context_value(
                        &mut initial,
                        lvalue.place.identifier,
                        lvalue.place.identifier,
                    );
                }
                InstructionValue::LoadContext { place, .. } => {
                    insert_context_value(&mut initial, place.identifier, place.identifier);
                }
                InstructionValue::PostfixUpdateContext { lvalue, value, .. }
                | InstructionValue::PrefixUpdateContext { lvalue, value, .. } => {
                    insert_context_value(&mut initial, lvalue.identifier, lvalue.identifier);
                    insert_context_value(&mut initial, value.identifier, value.identifier);
                }
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    for context_place in &functions[lowered_func.func.0 as usize].context {
                        insert_context_value(
                            &mut initial,
                            context_place.identifier,
                            context_place.identifier,
                        );
                    }
                }
                _ => {}
            }
        }
    }
    // Function declarations are initialized before the body executes, even though
    // their lexical StoreContext instruction appears later in HIR source order.
    // The last hoisted declaration wins, matching function instantiation.
    let mut hoisted_function_contexts: FxHashSet<IdentifierId> = FxHashSet::default();
    for (_, block) in &func.body.blocks {
        for &instruction_id in &block.instructions {
            let instr = &func.instructions[instruction_id.0 as usize];
            if let InstructionValue::DeclareContext { lvalue, .. } = &instr.value
                && lvalue.kind == InstructionKind::HoistedFunction
            {
                hoisted_function_contexts.insert(lvalue.place.identifier);
            }
        }
    }
    let mut hoisted_function_values = HoistedFunctionValues::default();
    if !hoisted_function_contexts.is_empty() {
        for (_, block) in &func.body.blocks {
            for &instruction_id in &block.instructions {
                let instr = &func.instructions[instruction_id.0 as usize];
                if let InstructionValue::StoreContext { lvalue, value, .. } = &instr.value
                    && lvalue.kind == InstructionKind::Function
                    && hoisted_function_contexts.contains(&lvalue.place.identifier)
                {
                    hoisted_function_values.insert(lvalue.place.identifier, value.identifier);
                }
            }
        }
    }

    let mut values_by_block: FxHashMap<BlockId, ContextValues> = FxHashMap::default();
    loop {
        let mut changed = false;
        for (&block_id, block) in &func.body.blocks {
            let mut values =
                context_values_at_block_entry(func, block_id, &initial, &values_by_block);
            for &instruction_id in &block.instructions {
                let instr = &func.instructions[instruction_id.0 as usize];
                update_context_values(&instr.value, &mut values, &hoisted_function_values);
            }
            if values_by_block.get(&block_id) != Some(&values) {
                values_by_block.insert(block_id, values);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }

    (initial, values_by_block, hoisted_function_values)
}

/// Recursively checks whether a function (or its dependencies) reassigns a
/// context variable.
///
/// Side effects: accumulates async-function reassignment diagnostics into `diagnostics`.
fn get_context_reassignment(
    func: &HirFunction,
    env: &Environment,
    context_variables: &mut FxHashSet<IdentifierId>,
    is_function_expression: bool,
    is_async: bool,
    diagnostics: &mut Vec<CompilerDiagnostic>,
) -> ReassignmentResult {
    if !env.has_stack() {
        return ReassignmentResult::default();
    }
    let identifiers = &env.identifiers;
    let functions = &env.functions;

    // Reassignment taint propagates through aliases, instruction results, and
    // phis. Build the complete graph before validating uses so loop backedges
    // and other cycles reach a fixpoint independent of block order.
    let mut propagation_edges = PropagationEdges::default();
    let mut correlated_values = CorrelatedValues::default();
    let mut seeds: Vec<(IdentifierId, Place)> = Vec::new();
    let mut returning_seeds: Vec<(IdentifierId, Place)> = Vec::new();
    let mut no_alias_calls: Vec<(InstructionId, Vec<IdentifierId>, ContextValues)> = Vec::new();
    let mut async_functions: FxHashSet<IdentifierId> = FxHashSet::default();
    let mut function_returns: FxHashMap<IdentifierId, ReturnedCallables> = FxHashMap::default();
    // Recursive results are computed once. They are needed again when an async
    // function is validated after the propagation graph reaches a fixpoint.
    let mut nested_reassignments: FxHashMap<IdentifierId, (ReassignmentResult, bool)> =
        FxHashMap::default();
    // Function values retain the context bindings they close over. Resolve those
    // bindings at each escape point so a definite overwrite can kill stale taint.
    let mut captured_contexts = CapturedContexts::default();
    let mut returned_captured_contexts = CapturedContexts::default();
    let mut returned_loaded_contexts = CapturedContexts::default();
    let (initial_context_values, context_values_by_block, hoisted_function_values) =
        infer_context_values_by_block(func, functions);

    for (&block_id, block) in &func.body.blocks {
        let mut context_values = context_values_at_block_entry(
            func,
            block_id,
            &initial_context_values,
            &context_values_by_block,
        );
        let mut correlated_context_values = correlated_context_values_at_block_entry(
            func,
            block_id,
            &initial_context_values,
            &context_values_by_block,
        );
        for phi in &block.phis {
            correlated_values.insert(
                phi.place.identifier,
                phi.operands
                    .iter()
                    .map(|(predecessor, operand)| (Some(*predecessor), operand.identifier))
                    .collect(),
            );
            for operand in phi.operands.values() {
                propagation_edges
                    .entry(operand.identifier)
                    .or_default()
                    .push(phi.place.identifier);
            }
        }

        for &instruction_id in &block.instructions {
            let instr = &func.instructions[instruction_id.0 as usize];
            if is_hoisted_function_store(&instr.value, &hoisted_function_values) {
                continue;
            }

            match &instr.value {
                InstructionValue::FunctionExpression { lowered_func, .. }
                | InstructionValue::ObjectMethod { lowered_func, .. } => {
                    let inner_function = &functions[lowered_func.func.0 as usize];
                    let inner_is_async = is_async || inner_function.is_async;

                    // Recursively check the inner function
                    let mut reassignment = get_context_reassignment(
                        inner_function,
                        env,
                        context_variables,
                        true,
                        inner_is_async && !inner_function.generator,
                        diagnostics,
                    );
                    if inner_function.generator {
                        reassignment.returned_callables.generator_reassignment = reassignment
                            .reassignment
                            .as_ref()
                            .map(|place| (place.identifier, place.loc));
                    }
                    function_returns.insert(
                        instr.lvalue.identifier,
                        reassignment.returned_callables.clone(),
                    );

                    // Async reassignments produce their own diagnostic and do
                    // not taint the function value, matching the TS behavior.
                    if inner_is_async {
                        async_functions.insert(instr.lvalue.identifier);
                    } else {
                        if let Some(reassignment_place) = &reassignment.reassignment {
                            seeds.push((instr.lvalue.identifier, reassignment_place.clone()));
                        }
                        if let Some(reassignment_place) = &reassignment.returned {
                            returning_seeds
                                .push((instr.lvalue.identifier, reassignment_place.clone()));
                        }
                        if !reassignment.returned_contexts.is_empty() {
                            returned_captured_contexts.insert(
                                instr.lvalue.identifier,
                                reassignment.returned_contexts.clone(),
                            );
                        }
                        if !reassignment.returned_context_loads.is_empty() {
                            returned_loaded_contexts.insert(
                                instr.lvalue.identifier,
                                reassignment.returned_context_loads.clone(),
                            );
                        }
                    }
                    // Captures are live bindings even for async functions. Keep
                    // their dependencies so a later context store is observed
                    // when the function value eventually escapes.
                    for context_place in &inner_function.context {
                        captured_contexts
                            .entry(instr.lvalue.identifier)
                            .or_default()
                            .insert(context_place.identifier);
                    }
                    nested_reassignments
                        .insert(instr.lvalue.identifier, (reassignment, inner_is_async));
                }

                InstructionValue::StoreLocal { lvalue, value, .. } => {
                    propagation_edges
                        .entry(value.identifier)
                        .or_default()
                        .extend([lvalue.place.identifier, instr.lvalue.identifier]);
                }

                InstructionValue::PostfixUpdateLocal { .. }
                | InstructionValue::PrefixUpdateLocal { .. } => {}

                InstructionValue::LoadLocal { place, .. } => {
                    propagation_edges
                        .entry(place.identifier)
                        .or_default()
                        .push(instr.lvalue.identifier);
                }

                InstructionValue::LoadContext { place, .. } => {
                    correlated_values.insert(
                        instr.lvalue.identifier,
                        correlated_context_values
                            .get(&place.identifier)
                            .cloned()
                            .unwrap_or_else(|| vec![(None, place.identifier)]),
                    );
                    connect_context_value(
                        &context_values,
                        place.identifier,
                        instr.lvalue.identifier,
                        &mut propagation_edges,
                    );
                }

                InstructionValue::DeclareContext { lvalue, .. } => {
                    if !is_function_expression {
                        context_variables.insert(lvalue.place.identifier);
                    }
                    let value = if lvalue.kind == InstructionKind::HoistedFunction {
                        hoisted_function_values
                            .get(&lvalue.place.identifier)
                            .copied()
                            .unwrap_or(lvalue.place.identifier)
                    } else {
                        lvalue.place.identifier
                    };
                    replace_context_value(&mut context_values, lvalue.place.identifier, value);
                    replace_correlated_value(
                        &mut correlated_context_values,
                        lvalue.place.identifier,
                        value,
                    );
                }

                InstructionValue::StoreContext { lvalue, value, .. } => {
                    if !is_function_expression {
                        context_variables.insert(lvalue.place.identifier);
                    }
                    propagation_edges
                        .entry(value.identifier)
                        .or_default()
                        .push(instr.lvalue.identifier);
                    replace_context_value(
                        &mut context_values,
                        lvalue.place.identifier,
                        value.identifier,
                    );
                    replace_correlated_value(
                        &mut correlated_context_values,
                        lvalue.place.identifier,
                        value.identifier,
                    );
                }

                InstructionValue::PostfixUpdateContext { lvalue, value, .. }
                | InstructionValue::PrefixUpdateContext { lvalue, value, .. } => {
                    if !is_function_expression {
                        context_variables.insert(lvalue.identifier);
                        context_variables.insert(value.identifier);
                    }
                    clear_context_value(&mut context_values, lvalue.identifier);
                    clear_correlated_value(&mut correlated_context_values, lvalue.identifier);
                }

                _ => {
                    for operand in each_reassigning_operand(&instr.value, env) {
                        // Invariant: effects must be inferred before this pass runs
                        if operand.effect == Effect::Unknown {
                            record_effects_not_inferred(diagnostics);
                            return ReassignmentResult::default();
                        }
                        if operand.effect != Effect::Freeze {
                            propagation_edges
                                .entry(operand.identifier)
                                .or_default()
                                .extend(lvalues(instr).map(|lvalue| lvalue.identifier));
                        }
                    }
                }
            }

            let argument_count = match &instr.value {
                InstructionValue::CallExpression { args, .. }
                | InstructionValue::MethodCall { args, .. } => args.len(),
                _ => 0,
            };
            if !no_alias_callback_parameters(&instr.value, env, true, argument_count).is_empty() {
                no_alias_calls.push((
                    instruction_id,
                    lvalues(instr).map(|lvalue| lvalue.identifier).collect(),
                    context_values.clone(),
                ));
            }
        }
    }

    let AsyncCallables {
        identifiers: async_function_values,
        invocations: async_invocations,
        returning_callbacks,
        returned: returned_callables,
        pending_before,
        pending_at_exit,
    } = infer_async_callable_contexts(
        func,
        &async_functions,
        &captured_contexts,
        &hoisted_function_values,
        &function_returns,
        env,
    );
    let no_alias_calls: Vec<(FxHashSet<IdentifierId>, Vec<IdentifierId>, ContextValues)> =
        no_alias_calls
            .into_iter()
            .filter_map(|(instruction, results, contexts)| {
                returning_callbacks
                    .get(&instruction)
                    .cloned()
                    .map(|callbacks| (callbacks, results, contexts))
            })
            .collect();
    propagate_captured_contexts(&mut captured_contexts, &propagation_edges);
    propagate_captured_contexts(&mut returned_captured_contexts, &propagation_edges);
    propagate_captured_contexts(&mut returned_loaded_contexts, &propagation_edges);
    for (callback_identifiers, result_identifiers, call_context_values) in &no_alias_calls {
        let mut contexts: FxHashSet<IdentifierId> = FxHashSet::default();
        for callback_identifier in callback_identifiers {
            // A direct return of a context load snapshots its current value.
            // Only a returned closure keeps observing later binding stores.
            if let Some(loaded_contexts) = returned_loaded_contexts.get(callback_identifier) {
                for &context in loaded_contexts {
                    for &result in result_identifiers {
                        connect_context_value(
                            call_context_values,
                            context,
                            result,
                            &mut propagation_edges,
                        );
                    }
                }
            }
            if let Some(callback_contexts) = returned_captured_contexts.get(callback_identifier) {
                contexts.extend(callback_contexts.iter().copied());
            }
        }
        for &result_identifier in result_identifiers {
            captured_contexts
                .entry(result_identifier)
                .or_default()
                .extend(contexts.iter().copied());
        }
    }
    propagate_captured_contexts(&mut captured_contexts, &propagation_edges);
    propagate_correlated_values(&mut correlated_values, &propagation_edges);

    let returning_functions = propagate_reassignments(&returning_seeds, &propagation_edges);
    let mut reassigning_functions = propagate_reassignments(&seeds, &propagation_edges);
    loop {
        let mut added_seed = false;
        let sources = ReassignmentSources {
            context_values_by_block: &context_values_by_block,
            reassigning_functions: &reassigning_functions,
            captured_contexts: &captured_contexts,
            correlated_values: &correlated_values,
        };
        for (callback_identifiers, result_identifiers, call_context_values) in &no_alias_calls {
            let reassignment_place = callback_identifiers.iter().find_map(|id| {
                returning_functions.get(id).cloned().or_else(|| {
                    returned_captured_contexts.get(id).and_then(|contexts| {
                        contexts.iter().find_map(|context| {
                            find_reassignment_for_operand(*context, call_context_values, &sources)
                        })
                    })
                })
            });
            if let Some(reassignment_place) = reassignment_place {
                for &result_identifier in result_identifiers {
                    if !reassigning_functions.contains_key(&result_identifier) {
                        seeds.push((result_identifier, reassignment_place.clone()));
                        added_seed = true;
                    }
                }
            }
        }
        if !added_seed {
            break;
        }
        reassigning_functions = propagate_reassignments(&seeds, &propagation_edges);
    }

    let mut returned_value_loads = CapturedContexts::default();
    for context_place in &func.context {
        returned_value_loads
            .entry(context_place.identifier)
            .or_default()
            .insert(context_place.identifier);
    }
    propagate_captured_contexts(&mut returned_value_loads, &propagation_edges);

    let sources = ReassignmentSources {
        context_values_by_block: &context_values_by_block,
        reassigning_functions: &reassigning_functions,
        captured_contexts: &captured_contexts,
        correlated_values: &correlated_values,
    };

    // With the complete fixed-point map, validate uses in source CFG order so
    // diagnostics retain their existing ordering.
    let mut result = ReassignmentResult {
        returned_callables,
        ..ReassignmentResult::default()
    };
    for (&block_id, block) in &func.body.blocks {
        let mut context_values = context_values_at_block_entry(
            func,
            block_id,
            &initial_context_values,
            &context_values_by_block,
        );

        for &instruction_id in &block.instructions {
            let instr = &func.instructions[instruction_id.0 as usize];
            if is_hoisted_function_store(&instr.value, &hoisted_function_values) {
                continue;
            }

            match &instr.value {
                InstructionValue::FunctionExpression { .. }
                | InstructionValue::ObjectMethod { .. } => {
                    if let Some((reassignment, inner_is_async)) =
                        nested_reassignments.get(&instr.lvalue.identifier)
                        && *inner_is_async
                        && !reassignment.returned_callables.generator
                        && let Some(reassignment_place) = &reassignment.reassignment
                    {
                        record_async_reassignment(reassignment_place, identifiers, diagnostics);
                        // Direct async reassignments are diagnosed immediately and
                        // do not propagate through the function value.
                        return ReassignmentResult::default();
                    }
                }

                InstructionValue::StoreContext { lvalue, .. } => {
                    if is_function_expression
                        && context_variables.contains(&lvalue.place.identifier)
                        && result.reassignment.is_none()
                    {
                        result.reassignment = Some(lvalue.place.clone());
                    }
                }

                InstructionValue::PostfixUpdateContext { lvalue, value, .. }
                | InstructionValue::PrefixUpdateContext { lvalue, value, .. } => {
                    if is_function_expression
                        && (context_variables.contains(&lvalue.identifier)
                            || context_variables.contains(&value.identifier))
                        && result.reassignment.is_none()
                    {
                        result.reassignment = Some(lvalue.clone());
                    }
                }

                InstructionValue::StoreLocal { .. }
                | InstructionValue::LoadLocal { .. }
                | InstructionValue::DeclareContext { .. } => {}

                _ => {
                    for operand in each_reassigning_operand(&instr.value, env) {
                        if operand.effect == Effect::Unknown {
                            record_effects_not_inferred(diagnostics);
                            return ReassignmentResult::default();
                        }
                        if operand.effect == Effect::Freeze
                            && let Some(reassignment_place) = find_reassignment_for_operand(
                                operand.identifier,
                                &context_values,
                                &sources,
                            )
                        {
                            if async_function_values.contains(&operand.identifier) {
                                record_async_reassignment(
                                    &reassignment_place,
                                    identifiers,
                                    diagnostics,
                                );
                                return ReassignmentResult::default();
                            }
                            if result.reassignment.is_none() {
                                result.reassignment = Some(reassignment_place);
                            }
                        }
                    }
                }
            }

            // An async continuation observes the live binding when execution
            // yields, not every intermediate store in the current synchronous job.
            if let Some(observation) = pending_before.get(&instruction_id) {
                for &context in &observation.deferred_captures {
                    if let Some(reassignment_place) = find_reassignment_for_operand(
                        context,
                        &observation.context_values,
                        &sources,
                    ) {
                        record_async_reassignment(&reassignment_place, identifiers, diagnostics);
                        return ReassignmentResult::default();
                    }
                }
            }

            if let Some(invocations) = async_invocations.get(&instruction_id) {
                for invocation in invocations {
                    if let Some((identifier, loc)) = invocation.reassignment {
                        record_async_reassignment(
                            &Place {
                                identifier,
                                effect: Effect::Unknown,
                                reactive: false,
                                loc,
                            },
                            identifiers,
                            diagnostics,
                        );
                        return ReassignmentResult::default();
                    }
                    for &context in &invocation.eager_captures {
                        if let Some(reassignment_place) = find_reassignment_for_operand(
                            context,
                            &invocation.context_values,
                            &sources,
                        ) {
                            record_async_reassignment(
                                &reassignment_place,
                                identifiers,
                                diagnostics,
                            );
                            return ReassignmentResult::default();
                        }
                    }
                }
            }
            update_context_values(&instr.value, &mut context_values, &hoisted_function_values);
        }

        // Leaving the function also allows pending async continuations to resume.
        if let Some(observation) = pending_at_exit.get(&block_id) {
            for &context in &observation.deferred_captures {
                if let Some(reassignment_place) =
                    find_reassignment_for_operand(context, &observation.context_values, &sources)
                {
                    record_async_reassignment(&reassignment_place, identifiers, diagnostics);
                    return ReassignmentResult::default();
                }
            }
        }

        // Check terminal operands for reassigning functions.
        let is_return = matches!(block.terminal, Terminal::Return { .. });
        for operand in terminal_operands(&block.terminal) {
            if is_return && let Some(contexts) = captured_contexts.get(&operand.identifier) {
                result.returned_contexts.extend(contexts.iter().copied());
            }
            if is_return && let Some(contexts) = returned_value_loads.get(&operand.identifier) {
                result
                    .returned_context_loads
                    .extend(contexts.iter().copied());
            }
            if let Some(reassignment_place) =
                find_reassignment_for_operand(operand.identifier, &context_values, &sources)
            {
                if async_function_values.contains(&operand.identifier) {
                    record_async_reassignment(&reassignment_place, identifiers, diagnostics);
                    return ReassignmentResult::default();
                }
                if is_return && result.returned.is_none() {
                    result.returned = Some(reassignment_place.clone());
                }
                if result.reassignment.is_none() {
                    result.reassignment = Some(reassignment_place);
                }
            }
        }
    }

    result
}
