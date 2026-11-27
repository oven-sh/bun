//! Not in upstream: oxc's `async_callable_contexts` as of oxlint 1.95 (oxc 8612f43be), for
//! `validate_captured_reassignments`. Nothing here is to be synced with upstream.
//!
//! Which functions each value can be, where they are called, and what an async one reads of its captured variables
//! before and after it first awaits.

use std::rc::Rc;

use super::validate_captured_reassignments::{no_alias_callback_parameters, signature_of};
use crate::collections::{FxHashMap, FxHashSet};
use crate::diagnostics::{JsString, SourceLocation};
use crate::hir::environment::Environment;
use crate::hir::visitors::{operands, terminal_operands, value_lvalues};
use crate::hir::{
    ArrayElement, ArrayPatternElement, BlockId, DeclarationId, HirFunction, IdentifierId,
    IdentifierName, Instruction, InstructionId, InstructionKind, InstructionValue,
    ObjectPropertyKey, ObjectPropertyOrSpread, ParamPattern, Pattern, PlaceOrSpread,
    PrimitiveValue, StoreStr, Terminal,
};

type Captures = FxHashMap<IdentifierId, FxHashSet<IdentifierId>>;
type Properties = FxHashMap<Option<String>, Values>;
type Members = FxHashSet<String>;
type Reassignment = (IdentifierId, Option<SourceLocation>);

#[derive(Clone, PartialEq, Eq, Hash)]
struct Projection {
    object: IdentifierId,
    key: Option<String>,
}

// Parameter member reads retain their source until a caller supplies the object.
// Instruction identities make this graph finite even for cyclic property walks.
type Projections = FxHashMap<IdentifierId, FxHashSet<Projection>>;

#[derive(Clone, PartialEq, Eq)]
struct Arguments {
    elements: Properties,
    length: Option<usize>,
}

impl Default for Arguments {
    fn default() -> Self {
        Self {
            elements: Properties::default(),
            length: Some(0),
        }
    }
}

impl Arguments {
    fn one(values: Values) -> Self {
        Self {
            elements: FxHashMap::from_iter([(Some("0".to_string()), values)]),
            length: Some(1),
        }
    }

    fn append(&mut self, other: &Self) {
        for (key, values) in &other.elements {
            let key = self.length.and_then(|offset| {
                key.as_ref()?
                    .parse::<usize>()
                    .ok()?
                    .checked_add(offset)
                    .map(|i| i.to_string())
            });
            self.elements.entry(key).or_default().extend(values);
        }
        self.length = self
            .length
            .zip(other.length)
            .and_then(|(a, b)| a.checked_add(b));
    }

    fn merge(&mut self, other: &Self) {
        merge_properties(&mut self.elements, &other.elements);
        if self.length != other.length {
            self.length = None;
        }
    }

    fn skip(mut self, count: usize) -> Self {
        self.elements = shifted(self.elements, count);
        self.length = self.length.map(|length| length.saturating_sub(count));
        self
    }

    /// Bound arguments snapshot their values: what they are, not what those capture.
    fn without_callables(mut self) -> Self {
        for values in self.elements.values_mut() {
            values.contexts.clear();
            values.iterators.clear();
        }
        self
    }
}

/// The elements from `count` on, as those of an array that starts there.
fn shifted(elements: Properties, count: usize) -> Properties {
    elements
        .into_iter()
        .filter_map(|(key, values)| {
            let key = match key {
                Some(key) => Some(key.parse::<usize>().ok()?.checked_sub(count)?.to_string()),
                None => None,
            };
            Some((key, values))
        })
        .collect()
}

fn is_index(key: &str) -> bool {
    key.parse::<usize>().is_ok()
}

fn name_key(name: &StoreStr) -> String {
    String::from_utf8_lossy(name.slice()).into_owned()
}

/// `None` for a string that has a lone surrogate.
fn string_key(value: JsString) -> Option<String> {
    match value.as_bytes() {
        Some(bytes) => core::str::from_utf8(bytes).ok().map(str::to_owned),
        None => String::from_utf16(value.estring().slice16()).ok(),
    }
}

/// A captured factory is resolved at its caller, where the live callee and its
/// returned-callable summary are available. Instruction identities bound cycles.
#[derive(Clone, Default, PartialEq, Eq)]
struct DeferredCall {
    callees: FxHashSet<IdentifierId>,
    arguments: Arguments,
}

impl DeferredCall {
    fn merge(&mut self, other: &Self) {
        self.callees.extend(&other.callees);
        self.arguments.merge(&other.arguments);
    }
}

type DeferredCalls = FxHashMap<IdentifierId, DeferredCall>;

fn merge_deferred_calls(into: &mut DeferredCalls, other: &DeferredCalls) {
    for (&id, call) in other {
        if let Some(into) = into.get_mut(&id) {
            into.merge(call);
        } else {
            into.insert(id, call.clone());
        }
    }
}

/// Calls executed by a function are distinct from its returned values. A caller
/// resolves captured or parameter callees before applying nested async effects.
#[derive(Clone, PartialEq, Eq)]
struct Call {
    callees: Values,
    arguments: Option<Arguments>,
}

/// Whether `value` is a tagged template in the source. The tree of `bun lint` has a call for one with substitutions,
/// and oxc a `TaggedTemplateExpression`: its substitutions come after the strings, and it is no call to a signature.
pub(super) fn is_tagged_template(value: &InstructionValue, env: &Environment) -> bool {
    match value {
        InstructionValue::CallExpression { loc: Some(loc), .. }
        | InstructionValue::MethodCall { loc: Some(loc), .. } => {
            env.tagged_template_calls.contains(loc)
        }
        _ => false,
    }
}

/// The names that the tree of `bun lint` has and the source has not. It destructures a parameter in the body where
/// oxc's lowering destructures it as a declaration: `({ a }) => ..` is `(t) => { let { a } = t; .. }`. The `t` is named,
/// and is to be the temporary that oxc has for the parameter. It is known by where it is read: that read has the
/// location of the declaration, and each node of the source has a location of its own.
fn converted_patterns(func: &HirFunction, env: &Environment) -> FxHashSet<DeclarationId> {
    let mut found = FxHashSet::default();
    for instruction in &func.instructions {
        let InstructionValue::LoadLocal {
            place,
            loc: Some(loc),
        } = &instruction.value
        else {
            continue;
        };
        let identifier = &env.identifiers[place.identifier.0 as usize];
        if identifier.loc == Some(*loc) && matches!(identifier.name, Some(IdentifierName::Named(_)))
        {
            found.insert(identifier.declaration_id);
        }
    }
    found
}

/// What the parameters declare. A parameter that is no plain name is a temporary, and what it declares is stored from
/// it by the instructions that the function starts with. oxc knows those by their place in the source, within the
/// parameter. Here a location is no range, so they are the instructions up to the last one that takes a value from
/// such a temporary: `HirFunction::instructions` is in the order of lowering, and the parameters are lowered first.
#[derive(Default)]
struct ParameterDeclarations {
    /// Each temporary that a parameter, or a part of one, goes through, with the index of the parameter.
    temporaries: FxHashMap<IdentifierId, usize>,
    /// Each name of the source that a parameter declares, with the index of the parameter.
    named: FxHashMap<DeclarationId, usize>,
    /// Everything that those instructions declare, and each parameter that is a plain name.
    all: FxHashSet<DeclarationId>,
}

fn parameter_declarations(func: &HirFunction, env: &Environment) -> ParameterDeclarations {
    let declaration_of = |id: IdentifierId| env.identifiers[id.0 as usize].declaration_id;
    let converted = converted_patterns(func, env);
    let is_source_name = |id: IdentifierId| {
        let identifier = &env.identifiers[id.0 as usize];
        matches!(identifier.name, Some(IdentifierName::Named(_)))
            && !converted.contains(&identifier.declaration_id)
    };

    let mut declared = ParameterDeclarations::default();
    let mut first_declaration: Option<DeclarationId> = None;
    for (index, param) in func.params.iter().enumerate() {
        let id = param.place().identifier;
        let declaration = declaration_of(id);
        first_declaration = Some(first_declaration.map_or(declaration, |it| it.min(declaration)));
        if matches!(param, ParamPattern::Place(_)) && is_source_name(id) {
            declared.named.insert(declaration, index);
            declared.all.insert(declaration);
        } else {
            declared.temporaries.insert(id, index);
        }
    }
    let Some(first_declaration) = first_declaration else {
        return declared;
    };
    if declared.temporaries.is_empty() {
        return declared;
    }

    let mut last: Option<usize> = None;
    loop {
        let mut changed = false;
        let mut add =
            |temporaries: &mut FxHashMap<IdentifierId, usize>, id: IdentifierId, index: usize| {
                if !temporaries.contains_key(&id) {
                    temporaries.insert(id, index);
                    changed = true;
                }
            };
        for (_, block) in &func.body.blocks {
            for phi in &block.phis {
                let index = phi
                    .operands
                    .values()
                    .find_map(|operand| declared.temporaries.get(&operand.identifier).copied());
                if let Some(index) = index {
                    add(&mut declared.temporaries, phi.place.identifier, index);
                }
            }
        }
        for (at, instruction) in func.instructions.iter().enumerate() {
            let source = match &instruction.value {
                InstructionValue::LoadLocal { place, .. } => place,
                InstructionValue::StoreLocal { value, .. }
                | InstructionValue::StoreContext { value, .. }
                | InstructionValue::Destructure { value, .. } => value,
                _ => continue,
            };
            let Some(&index) = declared.temporaries.get(&source.identifier) else {
                continue;
            };
            last = last.max(Some(at));
            if matches!(instruction.value, InstructionValue::LoadLocal { .. }) {
                add(
                    &mut declared.temporaries,
                    instruction.lvalue.identifier,
                    index,
                );
            }
            for place in value_lvalues(&instruction.value) {
                if is_source_name(place.identifier) {
                    declared
                        .named
                        .entry(declaration_of(place.identifier))
                        .or_insert(index);
                } else {
                    add(&mut declared.temporaries, place.identifier, index);
                }
            }
        }
        if !changed {
            break;
        }
    }
    if let Some(last) = last {
        for instruction in func.instructions.iter().take(last.saturating_add(1)) {
            for place in value_lvalues(&instruction.value) {
                let declaration = declaration_of(place.identifier);
                if declaration >= first_declaration {
                    declared.all.insert(declaration);
                }
            }
        }
    }
    declared
}

/// Each name of the source that a parameter of `func` declares, with the index of the parameter.
pub(crate) fn named_parameter_declarations(
    func: &HirFunction,
    env: &Environment,
) -> FxHashMap<DeclarationId, usize> {
    parameter_declarations(func, env).named
}

/// What the parameters bind. A temporary that is a parameter is not among the bindings.
fn parameter_bindings(func: &HirFunction, env: &Environment) -> FxHashSet<IdentifierId> {
    let declared = parameter_declarations(func, env);
    let is_temporary =
        |param: &ParamPattern| declared.temporaries.contains_key(&param.place().identifier);
    let mut bindings: FxHashSet<IdentifierId> = FxHashSet::default();
    for instruction in &func.instructions {
        for place in value_lvalues(&instruction.value) {
            let declaration = env.identifiers[place.identifier.0 as usize].declaration_id;
            if declared.all.contains(&declaration) {
                bindings.insert(place.identifier);
            }
        }
    }
    for param in &func.params {
        let id = param.place().identifier;
        match is_temporary(param) {
            true => bindings.remove(&id),
            false => bindings.insert(id),
        };
    }
    bindings
}

/// Preserve capture provenance through local snapshots, including object
/// projections. Instruction identities keep cyclic CFGs finite.
fn propagate_capture_origins(
    func: &HirFunction,
    origins: &mut Captures,
    stop_at: &FxHashSet<IdentifierId>,
) {
    loop {
        let mut changed = false;
        let mut copy = |from: IdentifierId, into: IdentifierId| {
            if stop_at.contains(&into) {
                return;
            }
            let values = origins.get(&from).cloned().unwrap_or_default();
            let target = origins.entry(into).or_default();
            let old_len = target.len();
            target.extend(values);
            changed |= old_len != target.len();
        };
        for (_, block) in &func.body.blocks {
            for phi in &block.phis {
                for operand in phi.operands.values() {
                    copy(operand.identifier, phi.place.identifier);
                }
            }
            for &id in &block.instructions {
                let instruction = &func.instructions[id.0 as usize];
                let into = instruction.lvalue.identifier;
                match &instruction.value {
                    InstructionValue::LoadLocal { place, .. }
                    | InstructionValue::LoadContext { place, .. }
                        if !stop_at.contains(&place.identifier) =>
                    {
                        copy(place.identifier, into)
                    }
                    InstructionValue::TypeCastExpression { value, .. } => {
                        copy(value.identifier, into)
                    }
                    InstructionValue::PropertyLoad { object, .. }
                    | InstructionValue::ComputedLoad { object, .. } => {
                        copy(object.identifier, into)
                    }
                    InstructionValue::StoreLocal { lvalue, value, .. }
                    | InstructionValue::StoreContext { lvalue, value, .. } => {
                        copy(value.identifier, lvalue.place.identifier);
                        copy(value.identifier, into);
                    }
                    _ => {}
                }
            }
        }
        if !changed {
            break;
        }
    }
}

/// Track binding reads and member observations separately: a saved object keeps
/// its identity before await, but its members are observed after suspension.
fn infer_capture_phases(
    func: &HirFunction,
    invocations: &FxHashMap<InstructionId, Vec<AsyncInvocation>>,
    member_reads: &FxHashMap<IdentifierId, Members>,
    parameters: &FxHashSet<IdentifierId>,
) -> (
    FxHashSet<IdentifierId>,
    FxHashSet<IdentifierId>,
    FxHashSet<IdentifierId>,
) {
    const EAGER: u8 = 1;
    const DEFERRED: u8 = 2;
    let contexts: FxHashSet<IdentifierId> = func
        .context
        .iter()
        .map(|place| place.identifier)
        .chain(parameters.iter().copied())
        .collect();
    let mut eager: FxHashSet<IdentifierId> = FxHashSet::default();
    let mut deferred: FxHashSet<IdentifierId> = FxHashSet::default();
    let mut snapshots: FxHashSet<IdentifierId> = FxHashSet::default();
    if contexts.is_empty() {
        return (eager, deferred, snapshots);
    }
    let mut phases: FxHashMap<BlockId, u8> = FxHashMap::default();
    let mut instruction_phases: FxHashMap<InstructionId, u8> = FxHashMap::default();
    loop {
        let mut changed = false;
        for (&block_id, block) in &func.body.blocks {
            let mut phase = if block_id == func.body.entry {
                EAGER
            } else {
                0
            };
            for predecessor in &block.preds {
                phase |= phases.get(predecessor).copied().unwrap_or_default();
            }
            if phase == 0 {
                continue;
            }
            for &id in &block.instructions {
                instruction_phases.insert(id, phase);
                if matches!(
                    func.instructions[id.0 as usize].value,
                    InstructionValue::Await { .. }
                ) {
                    phase = DEFERRED;
                }
            }
            if phases.get(&block_id) != Some(&phase) {
                phases.insert(block_id, phase);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    let mut origins: Captures = contexts
        .iter()
        .map(|&id| (id, FxHashSet::from_iter([id])))
        .collect();
    propagate_capture_origins(func, &mut origins, &FxHashSet::default());
    let mut before = Captures::default();
    let mut after = Captures::default();
    for (&id, &phase) in &instruction_phases {
        let instruction = &func.instructions[id.0 as usize];
        if let InstructionValue::LoadContext { place, .. }
        | InstructionValue::LoadLocal { place, .. } = &instruction.value
            && contexts.contains(&place.identifier)
        {
            if phase & EAGER != 0 {
                before
                    .entry(instruction.lvalue.identifier)
                    .or_default()
                    .insert(place.identifier);
            }
            if phase & DEFERRED != 0 {
                after
                    .entry(instruction.lvalue.identifier)
                    .or_default()
                    .insert(place.identifier);
            }
        }
    }
    propagate_capture_origins(func, &mut before, &contexts);
    propagate_capture_origins(func, &mut after, &contexts);
    for (&id, &phase) in &instruction_phases {
        for invocation in invocations.get(&id).into_iter().flatten() {
            if phase & EAGER != 0 {
                eager.extend(invocation.eager_captures.intersection(&contexts).copied());
                snapshots.extend(
                    invocation
                        .snapshot_captures
                        .intersection(&contexts)
                        .copied(),
                );
            }
            if phase & DEFERRED != 0 {
                deferred.extend(invocation.eager_captures.intersection(&contexts).copied());
                deferred.extend(
                    invocation
                        .snapshot_captures
                        .intersection(&contexts)
                        .copied(),
                );
            }
            deferred.extend(
                invocation
                    .deferred_captures
                    .intersection(&contexts)
                    .copied(),
            );
        }
        match &func.instructions[id.0 as usize].value {
            InstructionValue::LoadContext { place, .. }
            | InstructionValue::LoadLocal { place, .. }
                if contexts.contains(&place.identifier)
                    && !member_reads.contains_key(&place.identifier) =>
            {
                if phase & EAGER != 0 {
                    eager.insert(place.identifier);
                }
                if phase & DEFERRED != 0 {
                    deferred.insert(place.identifier);
                }
            }
            InstructionValue::PropertyLoad { object, .. }
            | InstructionValue::ComputedLoad { object, .. }
            | InstructionValue::Destructure { value: object, .. } => {
                for &binding in origins.get(&object.identifier).into_iter().flatten() {
                    if phase & EAGER != 0 {
                        eager.insert(binding);
                    }
                    if phase & DEFERRED != 0 {
                        let saved = before
                            .get(&object.identifier)
                            .is_some_and(|origins| origins.contains(&binding));
                        if saved {
                            snapshots.insert(binding);
                        }
                        if !saved
                            || after
                                .get(&object.identifier)
                                .is_some_and(|origins| origins.contains(&binding))
                        {
                            deferred.insert(binding);
                        }
                    }
                }
            }
            _ => {}
        }
    }
    (eager, deferred, snapshots)
}

/// Refine captures used only through named members. A direct escape, unknown
/// property, or nested closure keeps the whole capture. This lets a returned
/// closure select individual rest arguments without taint from unused siblings.
fn infer_capture_members(
    func: &HirFunction,
    env: &Environment,
    parameters: &FxHashSet<IdentifierId>,
    rest_arguments: bool,
) -> FxHashMap<IdentifierId, Members> {
    let mut members: FxHashMap<IdentifierId, Members> = func
        .context
        .iter()
        .map(|place| place.identifier)
        .chain(parameters.iter().copied())
        .map(|id| (id, Members::default()))
        .collect();
    if members.is_empty() {
        return members;
    }
    let mut origins: Captures = members
        .keys()
        .map(|&id| (id, FxHashSet::from_iter([id])))
        .collect();
    let mut keys: FxHashMap<IdentifierId, String> = FxHashMap::default();
    let mut receivers: FxHashMap<IdentifierId, IdentifierId> = FxHashMap::default();
    for instruction in &func.instructions {
        match &instruction.value {
            InstructionValue::Primitive {
                value: PrimitiveValue::String(value),
                ..
            } => {
                if let Some(value) = string_key(*value) {
                    keys.insert(instruction.lvalue.identifier, value);
                }
            }
            InstructionValue::Primitive {
                value: PrimitiveValue::Number(value),
                ..
            } => {
                keys.insert(instruction.lvalue.identifier, value.to_string());
            }
            InstructionValue::PropertyLoad {
                object, property, ..
            } => {
                if !rest_arguments || is_index(&property.to_string()) {
                    receivers.insert(instruction.lvalue.identifier, object.identifier);
                }
            }
            InstructionValue::ComputedLoad {
                object, property, ..
            } if !rest_arguments
                || keys
                    .get(&property.identifier)
                    .is_some_and(|key| is_index(key)) =>
            {
                receivers.insert(instruction.lvalue.identifier, object.identifier);
            }
            _ => {}
        }
    }
    loop {
        let mut changed = false;
        let mut copy = |from: IdentifierId, into: IdentifierId| {
            let values = origins.get(&from).cloned().unwrap_or_default();
            let target = origins.entry(into).or_default();
            let old_len = target.len();
            target.extend(values);
            changed |= old_len != target.len();
        };
        for (_, block) in &func.body.blocks {
            for phi in &block.phis {
                for operand in phi.operands.values() {
                    copy(operand.identifier, phi.place.identifier);
                }
            }
            for &id in &block.instructions {
                let instruction = &func.instructions[id.0 as usize];
                match &instruction.value {
                    InstructionValue::LoadLocal { place, .. }
                    | InstructionValue::LoadContext { place, .. } => {
                        copy(place.identifier, instruction.lvalue.identifier)
                    }
                    InstructionValue::TypeCastExpression { value, .. } => {
                        copy(value.identifier, instruction.lvalue.identifier)
                    }
                    InstructionValue::StoreLocal { lvalue, value, .. }
                    | InstructionValue::StoreContext { lvalue, value, .. } => {
                        copy(value.identifier, lvalue.place.identifier);
                        copy(value.identifier, instruction.lvalue.identifier);
                    }
                    _ => {}
                }
            }
        }
        if !changed {
            break;
        }
    }
    let remove = |id: IdentifierId, members: &mut FxHashMap<IdentifierId, Members>| {
        for origin in origins.get(&id).into_iter().flatten() {
            members.remove(origin);
        }
    };
    for instruction in &func.instructions {
        match &instruction.value {
            InstructionValue::PropertyLoad {
                object, property, ..
            } => {
                for origin in origins.get(&object.identifier).into_iter().flatten() {
                    if let Some(members) = members.get_mut(origin) {
                        members.insert(property.to_string());
                    }
                }
            }
            InstructionValue::ComputedLoad {
                object, property, ..
            } => {
                if let Some(key) = keys.get(&property.identifier) {
                    for origin in origins.get(&object.identifier).into_iter().flatten() {
                        if let Some(members) = members.get_mut(origin) {
                            members.insert(key.clone());
                        }
                    }
                } else {
                    remove(object.identifier, &mut members);
                }
            }
            InstructionValue::LoadLocal { .. }
            | InstructionValue::LoadContext { .. }
            | InstructionValue::StoreLocal { .. }
            | InstructionValue::StoreContext { .. }
            | InstructionValue::TypeCastExpression { .. } => {}
            InstructionValue::FunctionExpression { lowered_func, .. }
            | InstructionValue::ObjectMethod { lowered_func, .. } => {
                for context in &env.functions[lowered_func.func.0 as usize].context {
                    remove(context.identifier, &mut members);
                }
            }
            value => {
                for operand in operands(value, &env.functions) {
                    if let InstructionValue::MethodCall {
                        receiver, property, ..
                    } = value
                        && operand.identifier == receiver.identifier
                        && receivers.get(&property.identifier) == Some(&receiver.identifier)
                    {
                        continue;
                    }
                    remove(operand.identifier, &mut members);
                }
            }
        }
    }
    for (_, block) in &func.body.blocks {
        for operand in terminal_operands(&block.terminal) {
            remove(operand.identifier, &mut members);
        }
    }
    members
}

// Named members include every reaching write to that member. The unknown-key
// bucket is only the fallback for names that have not been written explicitly.
fn merge_properties(into: &mut Properties, other: &Properties) {
    let fallback = into.get(&None).cloned().unwrap_or_default();
    for (key, values) in into.iter_mut() {
        if let Some(other) = other.get(key).or_else(|| other.get(&None)) {
            values.extend(other);
        }
    }
    for (key, values) in other {
        if !into.contains_key(key) {
            let mut values = values.clone();
            values.extend(&fallback);
            into.insert(key.clone(), values);
        }
    }
}

pub(super) struct AsyncInvocation {
    pub reassignment: Option<Reassignment>,
    pub deferred_captures: FxHashSet<IdentifierId>,
    pub snapshot_captures: FxHashSet<IdentifierId>,
    pub eager_captures: FxHashSet<IdentifierId>,
    pub context_values: Rc<Captures>,
}

pub(super) struct AsyncCallables {
    pub identifiers: FxHashSet<IdentifierId>,
    pub invocations: FxHashMap<InstructionId, Vec<AsyncInvocation>>,
    pub returning_callbacks: FxHashMap<InstructionId, FxHashSet<IdentifierId>>,
    pub returned: ReturnedCallables,
    pub pending_before: FxHashMap<InstructionId, AsyncInvocation>,
    pub pending_at_exit: FxHashMap<BlockId, AsyncInvocation>,
}

#[derive(Clone, Default, PartialEq, Eq)]
pub(super) struct ReturnedCallables {
    calls: FxHashMap<InstructionId, Vec<Call>>,
    pub generator: bool,
    pub generator_reassignment: Option<Reassignment>,
    values: Values,
    external_contexts: FxHashSet<IdentifierId>,
    params: Vec<(IdentifierId, bool)>,
    capture_members: FxHashMap<IdentifierId, Members>,
    capture_reads: FxHashMap<IdentifierId, Members>,
    eager_captures: FxHashSet<IdentifierId>,
    deferred_captures: FxHashSet<IdentifierId>,
    snapshot_captures: FxHashSet<IdentifierId>,
    projections: Projections,
    deferred_calls: DeferredCalls,
    parameter_values: Captures,
}

#[derive(Clone, PartialEq, Eq)]
struct Callable {
    is_async: bool,
    generator: bool,
    deferred_captures: FxHashSet<IdentifierId>,
    snapshot_captures: FxHashSet<IdentifierId>,
    context_values: Rc<Captures>,
    returned: Option<Rc<ReturnedCallables>>,
    capture_members: FxHashMap<IdentifierId, Members>,
    capture_reads: FxHashMap<IdentifierId, Members>,
    eager_captures: FxHashSet<IdentifierId>,
    bound_arguments: Arguments,
}

impl Callable {
    /// The function that the instruction of `id` made, where the captured variables hold `context_values`.
    fn new(
        id: IdentifierId,
        context_values: Captures,
        async_functions: &FxHashSet<IdentifierId>,
        function_returns: &FxHashMap<IdentifierId, ReturnedCallables>,
    ) -> Self {
        let summary = function_returns.get(&id);
        Self {
            is_async: async_functions.contains(&id),
            generator: summary.is_some_and(|summary| summary.generator),
            deferred_captures: summary
                .map(|summary| summary.deferred_captures.clone())
                .unwrap_or_default(),
            snapshot_captures: summary
                .map(|summary| summary.snapshot_captures.clone())
                .unwrap_or_default(),
            context_values: Rc::new(context_values),
            returned: summary.cloned().map(Rc::new),
            capture_members: summary
                .map(|summary| summary.capture_members.clone())
                .unwrap_or_default(),
            capture_reads: summary
                .map(|summary| summary.capture_reads.clone())
                .unwrap_or_default(),
            eager_captures: summary
                .map(|summary| summary.eager_captures.clone())
                .unwrap_or_default(),
            bound_arguments: Arguments::default(),
        }
    }
}

/// Pair each possible function with the live bindings on the paths where
/// that function is selected. Merging another callable must not mix its bindings
/// into this function's captures.
#[derive(Clone, Default, PartialEq, Eq)]
struct Values {
    identities: FxHashSet<IdentifierId>,
    contexts: FxHashMap<IdentifierId, Callable>,
    iterators: FxHashMap<IdentifierId, Callable>,
}

impl Values {
    fn single(identifier: IdentifierId) -> Self {
        Self {
            identities: FxHashSet::from_iter([identifier]),
            ..Self::default()
        }
    }

    fn extend(&mut self, other: &Self) {
        self.identities.extend(&other.identities);
        for (target, source) in [
            (&mut self.contexts, &other.contexts),
            (&mut self.iterators, &other.iterators),
        ] {
            for (&function, callable) in source {
                let Some(into) = target.get_mut(&function) else {
                    target.insert(function, callable.clone());
                    continue;
                };
                into.bound_arguments.merge(&callable.bound_arguments);
                if Rc::ptr_eq(&into.context_values, &callable.context_values) {
                    continue;
                }
                let into = Rc::make_mut(&mut into.context_values);
                for (&binding, values) in callable.context_values.iter() {
                    into.entry(binding).or_default().extend(values);
                }
            }
        }
    }

    fn update_context(&mut self, binding: IdentifierId, values: &FxHashSet<IdentifierId>) {
        for callable in self
            .contexts
            .values_mut()
            .chain(self.iterators.values_mut())
        {
            Rc::make_mut(&mut callable.context_values).insert(binding, values.clone());
        }
    }
}

#[derive(Clone, Default, PartialEq, Eq)]
struct PendingCapture {
    roots: FxHashSet<IdentifierId>,
    snapshots: FxHashSet<IdentifierId>,
    live: bool,
    members: Option<Members>,
    observed: FxHashSet<IdentifierId>,
    dependencies: FxHashMap<IdentifierId, Option<Members>>,
}

fn merge_members(into: &mut Option<Members>, other: &Option<Members>) {
    if let Some(into_members) = into {
        if let Some(other) = other {
            into_members.extend(other.iter().cloned());
        } else {
            *into = None;
        }
    }
}

impl PendingCapture {
    fn merge(&mut self, other: &Self) {
        self.roots.extend(&other.roots);
        self.snapshots.extend(&other.snapshots);
        self.live |= other.live;
        merge_members(&mut self.members, &other.members);
        self.observed.extend(&other.observed);
        for (&id, members) in &other.dependencies {
            if let Some(into) = self.dependencies.get_mut(&id) {
                merge_members(into, members);
            } else {
                self.dependencies.insert(id, members.clone());
            }
        }
    }
}

#[derive(Clone, Default, PartialEq, Eq)]
struct CollectionContents {
    keys: Values,
    values: Values,
}

impl CollectionContents {
    fn extend(&mut self, other: &Self) {
        self.keys.extend(&other.keys);
        self.values.extend(&other.values);
    }
}

#[derive(Clone, Default, PartialEq, Eq)]
struct CallableState {
    values: FxHashMap<IdentifierId, Values>,
    context_values: Captures,
    properties: FxHashMap<IdentifierId, Properties>,
    keys: FxHashMap<IdentifierId, String>,
    builtin_function_methods: FxHashMap<IdentifierId, String>,
    array_lengths: FxHashMap<IdentifierId, usize>,
    arrays: FxHashSet<IdentifierId>,
    collections: FxHashMap<IdentifierId, CollectionContents>,
    projections: Projections,
    deferred_calls: DeferredCalls,
    pending: FxHashMap<IdentifierId, PendingCapture>,
}

impl CallableState {
    fn refresh_capture(&self, capture: &mut PendingCapture) {
        capture.observed.clear();
        capture.dependencies.clear();
        let mut pending: Vec<(IdentifierId, Option<Members>)> = capture
            .roots
            .iter()
            .chain(&capture.snapshots)
            .map(|&id| (id, capture.members.clone()))
            .collect();
        while let Some((id, mut members)) = pending.pop() {
            let mut collection_callback = false;
            if members
                .as_ref()
                .is_some_and(|members| members.contains("forEach"))
                && !self.properties.get(&id).is_some_and(|properties| {
                    properties.contains_key(&Some("forEach".to_string()))
                        || properties.contains_key(&None)
                })
                && let Some(contents) = self.collections.get(&id)
            {
                collection_callback = true;
                for value in contents
                    .keys
                    .identities
                    .iter()
                    .chain(&contents.values.identities)
                {
                    pending.push((*value, None));
                }
            }
            if self.arrays.contains(&id)
                && members.as_ref().is_some_and(|members| {
                    members.iter().any(|member| {
                        matches!(
                            member.as_str(),
                            "forEach"
                                | "map"
                                | "flatMap"
                                | "filter"
                                | "find"
                                | "findIndex"
                                | "findLast"
                                | "findLastIndex"
                                | "some"
                                | "every"
                                | "reduce"
                                | "reduceRight"
                                | "sort"
                                | "toSorted"
                        ) && self.properties.get(&id).is_some_and(|properties| {
                            !properties.contains_key(&Some(member.clone()))
                        })
                    })
                })
            {
                // Inherited array callback consumers can pass any element to
                // their callback. An own method still selects only that field.
                members = None;
            }
            if let Some(existing) = capture.dependencies.get_mut(&id) {
                let old = existing.clone();
                merge_members(existing, &members);
                if *existing == old {
                    continue;
                }
            } else {
                capture.dependencies.insert(id, members.clone());
            }
            let callable = self
                .values
                .get(&id)
                .filter(|values| !values.contexts.is_empty());
            if members.is_none()
                && let Some(callable) = callable
            {
                capture.observed.insert(id);
                capture.observed.extend(callable.contexts.keys().copied());
                continue;
            }
            let Some(properties) = self.properties.get(&id) else {
                if !collection_callback {
                    capture.observed.insert(id);
                }
                continue;
            };
            if let Some(members) = &members {
                for member in members {
                    if let Some(values) = properties
                        .get(&Some(member.clone()))
                        .or_else(|| properties.get(&None))
                    {
                        pending.extend(values.identities.iter().map(|&id| (id, None)));
                    }
                }
            } else {
                for values in properties.values() {
                    pending.extend(values.identities.iter().map(|&id| (id, None)));
                }
            }
        }
    }

    fn capture(&self, binding: IdentifierId, callable: &Callable) -> PendingCapture {
        let mut capture = PendingCapture {
            roots: callable
                .context_values
                .get(&binding)
                .cloned()
                .unwrap_or_else(|| FxHashSet::from_iter([binding])),
            members: callable.capture_reads.get(&binding).cloned(),
            ..PendingCapture::default()
        };
        self.refresh_capture(&mut capture);
        capture
    }

    fn invocation(
        &mut self,
        mut callable: Callable,
        arguments: Option<&Arguments>,
    ) -> AsyncInvocation {
        if let Some(arguments) = arguments
            && let Some(summary) = callable.returned.clone()
        {
            let (substitutions, rest) = self.call_substitutions(&callable, &summary, arguments);
            for (&binding, sources) in &summary.parameter_values {
                let mut flattened_rest = false;
                let mut identities: FxHashSet<IdentifierId> = FxHashSet::default();
                for &source in sources {
                    if let Some(elements) = rest.get(&source) {
                        flattened_rest = true;
                        let members = summary.capture_reads.get(&binding);
                        for (key, values) in elements {
                            if key.as_ref().is_none_or(|key| {
                                members.is_none_or(|members| members.contains(key))
                            }) {
                                identities.extend(&values.identities);
                            }
                        }
                        continue;
                    }
                    match self.substitute(
                        source,
                        &substitutions,
                        &summary.projections,
                        &summary.deferred_calls,
                        &rest,
                        &mut FxHashSet::default(),
                    ) {
                        Some(values) => identities.extend(values.identities),
                        None => {
                            identities.insert(source);
                        }
                    }
                }
                if flattened_rest {
                    callable.capture_reads.remove(&binding);
                }
                Rc::make_mut(&mut callable.context_values).insert(binding, identities);
            }
            for &(parameter, _) in &summary.params {
                if !summary.parameter_values.contains_key(&parameter)
                    && let Some(values) = substitutions.get(&parameter)
                {
                    Rc::make_mut(&mut callable.context_values)
                        .insert(parameter, values.identities.clone());
                }
                if let Some(elements) = rest.get(&parameter)
                    && let Some(members) = summary.capture_members.get(&parameter)
                {
                    let identities = indexed_members(elements, members);
                    Rc::make_mut(&mut callable.context_values).insert(parameter, identities);
                }
            }
        }
        let mut contexts = (*callable.context_values).clone();
        for &binding in &callable.eager_captures {
            contexts.insert(binding, self.capture(binding, &callable).observed);
        }
        for &binding in callable
            .deferred_captures
            .union(&callable.snapshot_captures)
        {
            let mut capture = self.capture(binding, &callable);
            capture.live = callable.deferred_captures.contains(&binding);
            if callable.snapshot_captures.contains(&binding) {
                capture.snapshots.clone_from(&capture.roots);
                if !capture.live {
                    capture.roots.clear();
                }
            }
            if let Some(current) = self.pending.get_mut(&binding) {
                current.merge(&capture);
            } else {
                self.pending.insert(binding, capture);
            }
        }
        AsyncInvocation {
            reassignment: callable
                .returned
                .as_ref()
                .and_then(|summary| summary.generator_reassignment),
            eager_captures: callable.eager_captures,
            deferred_captures: callable.deferred_captures,
            snapshot_captures: callable.snapshot_captures,
            context_values: Rc::new(contexts),
        }
    }

    fn execute_call(
        &mut self,
        call: &Call,
        visiting: &mut FxHashSet<IdentifierId>,
        invocations: &mut Vec<AsyncInvocation>,
    ) {
        for (&id, callable) in &call.callees.contexts {
            if callable.generator || !visiting.insert(id) {
                continue;
            }
            if callable.is_async {
                invocations.push(self.invocation(callable.clone(), call.arguments.as_ref()));
            } else if let Some(summary) = &callable.returned {
                let empty = Arguments::default();
                let (substitutions, rest) = self.call_substitutions(
                    callable,
                    summary,
                    call.arguments.as_ref().unwrap_or(&empty),
                );
                for nested in summary.calls.values().flatten() {
                    let callees = self.substitute_values(
                        &nested.callees,
                        summary,
                        &substitutions,
                        &rest,
                        &mut FxHashSet::default(),
                    );
                    let arguments = nested.arguments.as_ref().map(|arguments| Arguments {
                        length: arguments.length,
                        elements: arguments
                            .elements
                            .iter()
                            .map(|(key, values)| {
                                (
                                    key.clone(),
                                    self.substitute_values(
                                        values,
                                        summary,
                                        &substitutions,
                                        &rest,
                                        &mut FxHashSet::default(),
                                    ),
                                )
                            })
                            .collect(),
                    });
                    self.execute_call(&Call { callees, arguments }, visiting, invocations);
                }
            }
            visiting.remove(&id);
        }
    }

    fn pending_observation(&self) -> AsyncInvocation {
        let mut contexts = self.context_values.clone();
        for (&binding, capture) in &self.pending {
            contexts.insert(binding, capture.observed.clone());
        }
        AsyncInvocation {
            reassignment: None,
            eager_captures: FxHashSet::default(),
            deferred_captures: self.pending.keys().copied().collect(),
            snapshot_captures: FxHashSet::default(),
            context_values: Rc::new(contexts),
        }
    }

    fn invoked_callbacks(
        &self,
        instruction: &InstructionValue,
        env: &Environment,
        require_result_flow: bool,
    ) -> Values {
        let args = match instruction {
            _ if is_tagged_template(instruction, env) => return Values::default(),
            InstructionValue::CallExpression { args, .. }
            | InstructionValue::MethodCall { args, .. } => args,
            _ => return Values::default(),
        };
        let arguments = self.arguments(args);
        let count = arguments.length.unwrap_or_else(|| {
            arguments
                .elements
                .keys()
                .filter_map(|key| key.as_ref()?.parse::<usize>().ok())
                .max()
                .unwrap_or(0)
                .saturating_add(1)
        });
        let mut result = Values::default();
        for index in no_alias_callback_parameters(instruction, env, require_result_flow, count) {
            if let Some(values) = arguments.elements.get(&Some(index.to_string())) {
                result.extend(values);
            }
            if let Some(values) = arguments.elements.get(&None) {
                result.extend(values);
            }
        }
        result
    }

    fn callback_arguments(
        &self,
        instruction: &InstructionValue,
        env: &Environment,
    ) -> Option<Arguments> {
        let InstructionValue::MethodCall {
            receiver, property, ..
        } = instruction
        else {
            return None;
        };
        if is_tagged_template(instruction, env) {
            return None;
        }
        let signature = signature_of(env, property.identifier)?;
        if !matches!(
            signature.canonical_name,
            Some(
                "Array.map"
                    | "Array.flatMap"
                    | "Array.forEach"
                    | "Array.filter"
                    | "Array.every"
                    | "Array.some"
                    | "Array.find"
                    | "Array.findIndex"
                    | "Set.forEach"
                    | "Map.forEach"
            )
        ) {
            return None;
        }
        let mut items = Values::default();
        let mut keys = Values::default();
        let collection_callback = matches!(
            signature.canonical_name,
            Some("Set.forEach" | "Map.forEach")
        );
        if collection_callback {
            for id in self.values(receiver.identifier).identities {
                if let Some(contents) = self.collections.get(&id) {
                    items.extend(&contents.values);
                    keys.extend(&contents.keys);
                }
            }
        } else {
            for (key, values) in self.properties(receiver.identifier) {
                if key.as_ref().is_none_or(|key| is_index(key)) {
                    items.extend(&values);
                }
            }
        }
        Some(Arguments {
            elements: FxHashMap::from_iter([
                (Some("0".to_string()), items),
                (Some("1".to_string()), keys),
                (Some("2".to_string()), self.values(receiver.identifier)),
            ]),
            length: Some(3),
        })
    }

    fn update_collection(&mut self, instruction: &Instruction, env: &Environment) {
        if is_tagged_template(&instruction.value, env) {
            return;
        }
        let (callee, args) = match &instruction.value {
            InstructionValue::NewExpression { callee, args, .. } => (callee.identifier, args),
            InstructionValue::MethodCall { property, args, .. } => (property.identifier, args),
            _ => return,
        };
        let Some(signature) = signature_of(env, callee) else {
            return;
        };
        let arguments = self.arguments(args);
        let argument = |index: usize| {
            let mut values = arguments
                .elements
                .get(&Some(index.to_string()))
                .cloned()
                .unwrap_or_default();
            if let Some(unknown) = arguments.elements.get(&None) {
                values.extend(unknown);
            }
            values
        };
        match (&instruction.value, signature.canonical_name) {
            (InstructionValue::NewExpression { .. }, Some(name @ ("Set" | "Map"))) => {
                let mut contents = CollectionContents::default();
                for source in argument(0).identities {
                    if let Some(existing) = self.collections.get(&source) {
                        contents.extend(existing);
                    } else if let Some(properties) = self.properties.get(&source) {
                        for (key, item) in properties {
                            if key.as_ref().is_some_and(|key| !is_index(key)) {
                                continue;
                            }
                            if name == "Map" {
                                contents
                                    .keys
                                    .extend(&self.project(item, &Some("0".to_string())));
                                contents
                                    .values
                                    .extend(&self.project(item, &Some("1".to_string())));
                            } else {
                                contents.keys.extend(item);
                                contents.values.extend(item);
                            }
                        }
                    }
                }
                self.allocate(instruction.lvalue.identifier);
                self.collections
                    .insert(instruction.lvalue.identifier, contents);
            }
            (
                InstructionValue::MethodCall { receiver, .. },
                Some(name @ ("Set.add" | "Map.set" | "Set.clear" | "Map.clear")),
            ) => {
                let objects = self.values(receiver.identifier);
                let key = argument(0);
                let value = if name == "Map.set" {
                    argument(1)
                } else {
                    key.clone()
                };
                for object in &objects.identities {
                    if let Some(contents) = self.collections.get_mut(object) {
                        if name.ends_with(".clear") {
                            if objects.identities.len() == 1 {
                                *contents = CollectionContents::default();
                            }
                        } else {
                            contents.keys.extend(&key);
                            contents.values.extend(&value);
                        }
                    }
                }
                self.refresh_pending(&objects, Some(&"forEach".to_string()));
                if matches!(name, "Set.add" | "Map.set") {
                    self.values.insert(instruction.lvalue.identifier, objects);
                }
            }
            _ => {}
        }
    }

    fn values(&self, identifier: IdentifierId) -> Values {
        self.values.get(&identifier).cloned().unwrap_or_default()
    }

    fn copy(&mut self, from: IdentifierId, into: IdentifierId) {
        let values = self.values(from);
        self.values.insert(into, values);
        if let Some(key) = self.keys.get(&from).cloned() {
            self.keys.insert(into, key);
        } else {
            self.keys.remove(&into);
        }
        if let Some(method) = self.builtin_function_methods.get(&from).cloned() {
            self.builtin_function_methods.insert(into, method);
        } else {
            self.builtin_function_methods.remove(&into);
        }
    }

    fn allocate(&mut self, identifier: IdentifierId) {
        self.values.insert(identifier, Values::single(identifier));
    }

    fn update_context(&mut self, binding: IdentifierId) {
        let values = self.values(binding).identities;
        if let Some(mut capture) = self.pending.remove(&binding) {
            if capture.live {
                capture.roots.clone_from(&values);
                self.refresh_capture(&mut capture);
            }
            self.pending.insert(binding, capture);
        }
        self.context_values.insert(binding, values.clone());
        for value in self.values.values_mut() {
            value.update_context(binding, &values);
        }
        for contents in self.collections.values_mut() {
            contents.keys.update_context(binding, &values);
            contents.values.update_context(binding, &values);
        }
        for properties in self.properties.values_mut() {
            for value in properties.values_mut() {
                value.update_context(binding, &values);
            }
        }
    }

    fn merge(&mut self, other: &Self) {
        for (&binding, capture) in &other.pending {
            if let Some(into) = self.pending.get_mut(&binding) {
                into.merge(capture);
            } else {
                self.pending.insert(binding, capture.clone());
            }
        }
        for (&binding, values) in &other.context_values {
            self.context_values
                .entry(binding)
                .or_default()
                .extend(values);
        }
        for (&id, values) in &other.values {
            self.values.entry(id).or_default().extend(values);
        }
        for (&object, properties) in &other.properties {
            merge_properties(self.properties.entry(object).or_default(), properties);
        }
        self.keys
            .retain(|id, key| other.keys.get(id) == Some(&*key));
        self.builtin_function_methods
            .retain(|id, method| other.builtin_function_methods.get(id) == Some(&*method));
        self.array_lengths
            .retain(|id, length| other.array_lengths.get(id) == Some(&*length));
        self.arrays.extend(&other.arrays);
        for (&id, contents) in &other.collections {
            self.collections.entry(id).or_default().extend(contents);
        }
        merge_deferred_calls(&mut self.deferred_calls, &other.deferred_calls);
        for (&id, projections) in &other.projections {
            self.projections
                .entry(id)
                .or_default()
                .extend(projections.iter().cloned());
        }
    }

    fn key(&self, property: &ObjectPropertyKey) -> Option<String> {
        match property {
            ObjectPropertyKey::Identifier { name } | ObjectPropertyKey::String { name } => {
                Some(name_key(name))
            }
            ObjectPropertyKey::Number { name } => Some(name.to_string()),
            ObjectPropertyKey::Computed { name } => self.keys.get(&name.identifier).cloned(),
        }
    }

    fn properties(&self, identifier: IdentifierId) -> Properties {
        let mut result = Properties::default();
        for object in self
            .values
            .get(&identifier)
            .into_iter()
            .flat_map(|values| &values.identities)
        {
            if let Some(properties) = self.properties.get(object) {
                merge_properties(&mut result, properties);
            }
        }
        result
    }

    fn load(&mut self, object: IdentifierId, key: Option<String>, into: IdentifierId) {
        let properties = self.properties(object);
        if let Some(key) = &key
            && ((matches!(key.as_str(), "call" | "apply" | "bind")
                && !self.values(object).contexts.is_empty())
                || (key == "next" && !self.values(object).iterators.is_empty()))
            && !properties.contains_key(&Some(key.clone()))
            && !properties.contains_key(&None)
        {
            self.builtin_function_methods.insert(into, key.clone());
        } else {
            self.builtin_function_methods.remove(&into);
        }
        let mut values = if key.is_some() {
            properties
                .get(&key)
                .or_else(|| properties.get(&None))
                .cloned()
                .unwrap_or_default()
        } else {
            properties
                .into_values()
                .fold(Values::default(), |mut result, values| {
                    result.extend(&values);
                    result
                })
        };
        for object in self.values(object).identities {
            if self.projections.contains_key(&object) {
                self.projections
                    .entry(into)
                    .or_default()
                    .insert(Projection {
                        object,
                        key: key.clone(),
                    });
                values.identities.insert(into);
            }
        }
        self.values.insert(into, values);
        self.keys.remove(&into);
    }

    fn invoked(&self, instruction: &InstructionValue, env: &Environment) -> Values {
        match instruction {
            InstructionValue::CallExpression { callee, .. }
            | InstructionValue::NewExpression { callee, .. } => self.values(callee.identifier),
            InstructionValue::MethodCall { property, .. }
                if is_tagged_template(instruction, env) =>
            {
                self.values(property.identifier)
            }
            InstructionValue::MethodCall {
                receiver, property, ..
            } => match self
                .builtin_function_methods
                .get(&property.identifier)
                .map(String::as_str)
            {
                None | Some("bind") => self.values(property.identifier),
                Some(method) => {
                    let mut values = self.values(receiver.identifier);
                    if method == "next" {
                        values.contexts = std::mem::take(&mut values.iterators);
                        for callable in values.contexts.values_mut() {
                            callable.generator = false;
                        }
                    }
                    values
                }
            },
            InstructionValue::TaggedTemplateExpression { tag, .. } => self.values(tag.identifier),
            _ => Values::default(),
        }
    }

    fn array_length(&self, values: &Values) -> Option<usize> {
        let mut lengths = values
            .identities
            .iter()
            .map(|id| self.array_lengths.get(id).copied());
        let length = lengths.next()??;
        lengths.all(|other| other == Some(length)).then_some(length)
    }

    /// What `...place` gives, as arguments or as elements of an array.
    fn spread(&self, identifier: IdentifierId) -> Arguments {
        Arguments {
            elements: self.properties(identifier),
            length: self.array_length(&self.values(identifier)),
        }
    }

    fn arguments(&self, args: &[PlaceOrSpread]) -> Arguments {
        let mut result = Arguments::default();
        for argument in args {
            let next = match argument {
                PlaceOrSpread::Place(place) => Arguments::one(self.values(place.identifier)),
                PlaceOrSpread::Spread(spread) => self.spread(spread.place.identifier),
            };
            result.append(&next);
        }
        result
    }

    fn project(&self, objects: &Values, key: &Option<String>) -> Values {
        let mut result = Values::default();
        for object in &objects.identities {
            let Some(properties) = self.properties.get(object) else {
                continue;
            };
            if key.is_some() {
                if let Some(values) = properties.get(key).or_else(|| properties.get(&None)) {
                    result.extend(values);
                }
            } else {
                for values in properties.values() {
                    result.extend(values);
                }
            }
        }
        result
    }

    fn substitute(
        &self,
        id: IdentifierId,
        substitutions: &FxHashMap<IdentifierId, Values>,
        projections: &Projections,
        deferred_calls: &DeferredCalls,
        rest_arguments: &FxHashMap<IdentifierId, Properties>,
        visiting: &mut FxHashSet<IdentifierId>,
    ) -> Option<Values> {
        if let Some(values) = substitutions.get(&id) {
            return Some(values.clone());
        }
        if let Some(call) = deferred_calls.get(&id) {
            if !visiting.insert(id) {
                return None;
            }
            let mut callees = Values::default();
            for &callee in &call.callees {
                let selected = self
                    .substitute(
                        callee,
                        substitutions,
                        projections,
                        deferred_calls,
                        rest_arguments,
                        visiting,
                    )
                    .unwrap_or_else(|| self.values(callee));
                callees.extend(&selected);
            }
            let mut arguments = call.arguments.clone();
            for values in arguments.elements.values_mut() {
                for value in values.identities.clone() {
                    if let Some(selected) = self.substitute(
                        value,
                        substitutions,
                        projections,
                        deferred_calls,
                        rest_arguments,
                        visiting,
                    ) {
                        values.identities.remove(&value);
                        values.extend(&selected);
                    }
                }
            }
            let mut result = Values::default();
            for callable in callees.contexts.values() {
                result.extend(&self.returned_values(callable, &arguments, visiting));
            }
            if callees.contexts.is_empty() {
                result.identities.insert(id);
            }
            visiting.remove(&id);
            return Some(result);
        }
        let sources = projections.get(&id)?;
        if sources.is_empty() || !visiting.insert(id) {
            return None;
        }
        let mut result = Values::default();
        for source in sources {
            if let Some(elements) = rest_arguments.get(&source.object) {
                if source.key.is_some() {
                    if let Some(values) = elements.get(&source.key).or_else(|| elements.get(&None))
                    {
                        result.extend(values);
                    }
                } else {
                    for values in elements.values() {
                        result.extend(values);
                    }
                }
                continue;
            }
            if let Some(objects) = self.substitute(
                source.object,
                substitutions,
                projections,
                deferred_calls,
                rest_arguments,
                visiting,
            ) {
                result.extend(&self.project(&objects, &source.key));
            } else {
                result.identities.insert(id);
            }
        }
        visiting.remove(&id);
        Some(result)
    }

    fn call_substitutions(
        &self,
        callable: &Callable,
        returned: &ReturnedCallables,
        arguments: &Arguments,
    ) -> (
        FxHashMap<IdentifierId, Values>,
        FxHashMap<IdentifierId, Properties>,
    ) {
        let mut arguments = {
            let mut bound = callable.bound_arguments.clone();
            bound.append(arguments);
            bound
        };
        for values in arguments.elements.values_mut() {
            for identity in values.identities.clone() {
                values.extend(&self.values(identity));
            }
        }
        let mut substitutions: FxHashMap<IdentifierId, Values> = FxHashMap::default();
        let mut rest_arguments: FxHashMap<IdentifierId, Properties> = FxHashMap::default();
        for &binding in &returned.external_contexts {
            if let Some(identities) = callable.context_values.get(&binding) {
                let mut values = Values::default();
                values.identities.clone_from(identities);
                for &id in identities {
                    values.extend(&self.values(id));
                }
                substitutions.insert(binding, values);
            }
        }
        for (index, &(parameter, is_rest)) in returned.params.iter().enumerate() {
            if is_rest {
                let elements = shifted(arguments.elements.clone(), index);
                let mut values = Values::default();
                for element in elements.values() {
                    values.extend(element);
                }
                substitutions.insert(parameter, values);
                rest_arguments.insert(parameter, elements);
            } else {
                let mut values = arguments
                    .elements
                    .get(&Some(index.to_string()))
                    .cloned()
                    .unwrap_or_default();
                if let Some(unknown) = arguments.elements.get(&None) {
                    values.extend(unknown);
                }
                substitutions.insert(parameter, values);
            }
        }
        (substitutions, rest_arguments)
    }

    fn call_arguments(
        &self,
        instruction: &Instruction,
        env: &Environment,
    ) -> (Arguments, Option<IdentifierId>) {
        let mut binding = None;
        let arguments = match &instruction.value {
            InstructionValue::CallExpression { args, .. }
            | InstructionValue::MethodCall { args, .. }
                if is_tagged_template(&instruction.value, env) =>
            {
                Arguments {
                    elements: args
                        .iter()
                        .enumerate()
                        .map(|(index, argument)| {
                            (
                                Some((index + 1).to_string()),
                                self.values(argument.place().identifier),
                            )
                        })
                        .collect(),
                    length: Some(args.len() + 1),
                }
            }
            InstructionValue::CallExpression { args, .. }
            | InstructionValue::NewExpression { args, .. } => self.arguments(args),
            InstructionValue::MethodCall {
                receiver,
                property,
                args,
                ..
            } => {
                match self
                    .builtin_function_methods
                    .get(&property.identifier)
                    .map(String::as_str)
                {
                    Some("bind") => {
                        binding = Some(receiver.identifier);
                        self.arguments(args).skip(1)
                    }
                    Some("call") => self.arguments(args).skip(1),
                    Some("next") => Arguments::default(),
                    Some("apply") => args.get(1).map_or_else(Arguments::default, |argument| {
                        self.spread(argument.place().identifier)
                    }),
                    _ => self.arguments(args),
                }
            }
            // The strings of the template are the first argument, and this one has no substitutions.
            InstructionValue::TaggedTemplateExpression { .. } => Arguments {
                elements: Properties::default(),
                length: Some(1),
            },
            _ => Arguments::default(),
        };
        (arguments, binding)
    }

    fn call_result(&mut self, instruction: &Instruction, env: &Environment) {
        let (arguments, binding) = self.call_arguments(instruction, env);
        if let Some(receiver) = binding {
            let mut values = self.values(receiver);
            // Bound arguments snapshot their values. Keep identities here so
            // binding a function to itself cannot build recursive summaries.
            let arguments = arguments.without_callables();
            for callable in values.contexts.values_mut() {
                callable.bound_arguments.append(&arguments);
            }
            values.identities = FxHashSet::from_iter([instruction.lvalue.identifier]);
            self.values.insert(instruction.lvalue.identifier, values);
            return;
        }
        let invoked = self.invoked(&instruction.value, env);
        let mut result = Values::default();
        for callable in invoked.contexts.values() {
            if callable.generator {
                // Calling a generator snapshots its arguments, but neither runs
                // its body nor observes its live captured bindings yet.
                let mut callable = callable.clone();
                callable
                    .bound_arguments
                    .append(&arguments.clone().without_callables());
                let id = instruction.lvalue.identifier;
                let iterator = Values {
                    identities: FxHashSet::from_iter([id]),
                    iterators: FxHashMap::from_iter([(id, callable)]),
                    ..Values::default()
                };
                result.extend(&iterator);
                continue;
            }
            result.extend(&self.returned_values(callable, &arguments, &mut FxHashSet::default()));
        }
        let callees: FxHashSet<IdentifierId> = invoked
            .identities
            .iter()
            .filter(|&id| self.projections.contains_key(id))
            .copied()
            .collect();
        if !callees.is_empty() {
            self.deferred_calls.insert(
                instruction.lvalue.identifier,
                DeferredCall { callees, arguments },
            );
            self.projections
                .entry(instruction.lvalue.identifier)
                .or_default();
            result.identities.insert(instruction.lvalue.identifier);
        }
        self.values.insert(instruction.lvalue.identifier, result);
    }

    fn returned_values(
        &self,
        callable: &Callable,
        arguments: &Arguments,
        visiting: &mut FxHashSet<IdentifierId>,
    ) -> Values {
        // Async calls produce promises, not the eventual returned callable.
        if callable.is_async {
            return Values::default();
        }
        let Some(returned) = &callable.returned else {
            return Values::default();
        };
        let (substitutions, rest_arguments) =
            self.call_substitutions(callable, returned, arguments);
        self.substitute_values(
            &returned.values,
            returned,
            &substitutions,
            &rest_arguments,
            visiting,
        )
    }

    fn substitute_values(
        &self,
        original: &Values,
        returned: &ReturnedCallables,
        substitutions: &FxHashMap<IdentifierId, Values>,
        rest_arguments: &FxHashMap<IdentifierId, Properties>,
        visiting: &mut FxHashSet<IdentifierId>,
    ) -> Values {
        let mut values = original.clone();
        // Returning a parameter snapshots the selected callable; a newly
        // returned closure retains the caller's live binding information.
        for identity in &original.identities {
            if let Some(selected) = self.substitute(
                *identity,
                substitutions,
                &returned.projections,
                &returned.deferred_calls,
                rest_arguments,
                visiting,
            ) {
                values.identities.remove(identity);
                values.extend(&selected);
            }
        }
        for closure in values
            .contexts
            .values_mut()
            .chain(values.iterators.values_mut())
        {
            let capture_members = &closure.capture_members;
            for (&binding, values) in Rc::make_mut(&mut closure.context_values).iter_mut() {
                if returned.external_contexts.contains(&binding)
                    && let Some(current) = substitutions.get(&binding)
                {
                    *values = current.identities.clone();
                    continue;
                }
                let mut selected: FxHashSet<IdentifierId> = FxHashSet::default();
                for &value in values.iter() {
                    if let Some(elements) = rest_arguments.get(&value)
                        && let Some(members) = capture_members.get(&binding)
                    {
                        selected.extend(indexed_members(elements, members));
                        continue;
                    }
                    match self.substitute(
                        value,
                        substitutions,
                        &returned.projections,
                        &returned.deferred_calls,
                        rest_arguments,
                        visiting,
                    ) {
                        Some(values) => selected.extend(values.identities),
                        None => {
                            selected.insert(value);
                        }
                    }
                }
                *values = selected;
            }
        }
        values
    }

    fn store(&mut self, object: IdentifierId, key: Option<String>, values: Values) {
        let objects = self.values(object);
        let definite = objects.identities.len() == 1 && key.is_some();
        for &object in &objects.identities {
            self.array_lengths.remove(&object);
            let properties = self.properties.entry(object).or_default();
            if key.is_none() {
                for property in properties.values_mut() {
                    property.extend(&values);
                }
                properties.entry(None).or_default().extend(&values);
            } else if definite {
                properties.insert(key.clone(), values.clone());
            } else {
                let fallback = properties.get(&None).cloned().unwrap_or_default();
                properties
                    .entry(key.clone())
                    .or_insert(fallback)
                    .extend(&values);
            }
        }
        self.refresh_pending(&objects, key.as_ref());
    }

    fn refresh_pending(&mut self, objects: &Values, key: Option<&String>) {
        // Update only pending reads touched by this write. Recomputing every
        // capture after a CFG join would mix in stores from non-invoking paths.
        let affected: Vec<IdentifierId> = self
            .pending
            .iter()
            .filter_map(|(&binding, capture)| {
                objects
                    .identities
                    .iter()
                    .any(|object| {
                        capture.dependencies.get(object).is_some_and(|members| {
                            key.is_none_or(|key| {
                                members.as_ref().is_none_or(|members| members.contains(key))
                            })
                        })
                    })
                    .then_some(binding)
            })
            .collect();
        for binding in affected {
            if let Some(mut capture) = self.pending.remove(&binding) {
                self.refresh_capture(&mut capture);
                self.pending.insert(binding, capture);
            }
        }
    }

    fn destructure(&mut self, pattern: &Pattern, source: IdentifierId) {
        match pattern {
            Pattern::Object(pattern) => {
                let mut excluded: Members = Members::default();
                for property in &pattern.properties {
                    match property {
                        ObjectPropertyOrSpread::Property(property) => {
                            let key = self.key(&property.key);
                            if let Some(key) = &key {
                                excluded.insert(key.clone());
                            }
                            self.load(source, key, property.place.identifier);
                        }
                        ObjectPropertyOrSpread::Spread(spread) => {
                            let mut properties = self.properties(source);
                            properties.retain(|key, _| {
                                key.as_ref().is_none_or(|key| !excluded.contains(key))
                            });
                            self.allocate(spread.place.identifier);
                            self.properties.insert(spread.place.identifier, properties);
                        }
                    }
                }
            }
            Pattern::Array(pattern) => {
                for (index, element) in pattern.items.iter().enumerate() {
                    match element {
                        ArrayPatternElement::Place(place) => {
                            self.load(source, Some(index.to_string()), place.identifier)
                        }
                        ArrayPatternElement::Spread(spread) => {
                            let properties = shifted(self.properties(source), index);
                            self.allocate(spread.place.identifier);
                            self.properties.insert(spread.place.identifier, properties);
                        }
                        ArrayPatternElement::Hole => {}
                    }
                }
            }
        }
    }

    fn apply(
        &mut self,
        instruction: &Instruction,
        hoisted: &FxHashMap<IdentifierId, IdentifierId>,
        async_functions: &FxHashSet<IdentifierId>,
        captured_contexts: &Captures,
        function_returns: &FxHashMap<IdentifierId, ReturnedCallables>,
        captured_bindings: &FxHashSet<IdentifierId>,
        env: &Environment,
    ) {
        let id = instruction.lvalue.identifier;
        match &instruction.value {
            InstructionValue::FunctionExpression { .. } | InstructionValue::ObjectMethod { .. } => {
                let mut contexts = self.context_values.clone();
                for &capture in captured_contexts.get(&id).into_iter().flatten() {
                    contexts
                        .entry(capture)
                        .or_insert_with(|| FxHashSet::from_iter([capture]));
                }
                let mut values = Values::single(id);
                values.contexts.insert(
                    id,
                    Callable::new(id, contexts, async_functions, function_returns),
                );
                self.values.insert(id, values);
            }
            InstructionValue::Primitive { value, .. } => {
                let key = match value {
                    PrimitiveValue::String(value) => string_key(*value),
                    PrimitiveValue::Number(value) => Some(value.to_string()),
                    PrimitiveValue::BigInt(value) => Some(name_key(value)),
                    PrimitiveValue::Boolean(value) => Some(value.to_string()),
                    PrimitiveValue::Null => Some("null".to_string()),
                    PrimitiveValue::Undefined => Some("undefined".to_string()),
                };
                if let Some(key) = key {
                    self.keys.insert(id, key);
                } else {
                    self.keys.remove(&id);
                }
                self.values.insert(id, Values::default());
            }
            InstructionValue::LoadLocal { place, .. }
            | InstructionValue::LoadContext { place, .. } => self.copy(place.identifier, id),
            InstructionValue::TypeCastExpression { value, .. } => self.copy(value.identifier, id),
            InstructionValue::StoreLocal { lvalue, value, .. }
            | InstructionValue::StoreContext { lvalue, value, .. } => {
                let is_context = matches!(instruction.value, InstructionValue::StoreContext { .. });
                if is_context
                    && lvalue.kind == InstructionKind::Function
                    && hoisted.contains_key(&lvalue.place.identifier)
                {
                    return;
                }
                self.copy(value.identifier, lvalue.place.identifier);
                self.copy(value.identifier, id);
                if is_context || captured_bindings.contains(&lvalue.place.identifier) {
                    self.update_context(lvalue.place.identifier);
                }
            }
            InstructionValue::DeclareContext { lvalue, .. } => {
                if lvalue.kind == InstructionKind::HoistedFunction
                    && let Some(&value) = hoisted.get(&lvalue.place.identifier)
                {
                    let mut values = Values::single(value);
                    values.contexts.insert(
                        value,
                        Callable::new(
                            value,
                            self.context_values.clone(),
                            async_functions,
                            function_returns,
                        ),
                    );
                    self.values.insert(lvalue.place.identifier, values);
                } else {
                    self.values
                        .insert(lvalue.place.identifier, Values::default());
                }
                self.keys.remove(&lvalue.place.identifier);
                self.update_context(lvalue.place.identifier);
            }
            InstructionValue::ObjectExpression { properties, .. } => {
                self.allocate(id);
                self.properties.insert(id, Properties::default());
                for property in properties {
                    match property {
                        ObjectPropertyOrSpread::Property(property) => {
                            let key = self.key(&property.key);
                            let values = self.values(property.place.identifier);
                            self.store(id, key, values);
                        }
                        ObjectPropertyOrSpread::Spread(spread) => {
                            let mut properties = self.properties(spread.place.identifier);
                            if let Some(values) = properties.remove(&None) {
                                self.store(id, None, values);
                            }
                            for (key, values) in properties {
                                self.store(id, key, values);
                            }
                        }
                    }
                }
            }
            InstructionValue::ArrayExpression { elements, .. } => {
                self.allocate(id);
                self.arrays.insert(id);
                let mut contents = Arguments::default();
                for element in elements {
                    let next = match element {
                        ArrayElement::Place(place) => Arguments::one(self.values(place.identifier)),
                        ArrayElement::Spread(spread) => self.spread(spread.place.identifier),
                        ArrayElement::Hole => Arguments {
                            elements: Properties::default(),
                            length: Some(1),
                        },
                    };
                    contents.append(&next);
                }
                self.properties.insert(id, contents.elements);
                if let Some(length) = contents.length {
                    self.array_lengths.insert(id, length);
                } else {
                    self.array_lengths.remove(&id);
                }
            }
            InstructionValue::PropertyLoad {
                object, property, ..
            } => self.load(object.identifier, Some(property.to_string()), id),
            InstructionValue::ComputedLoad {
                object, property, ..
            } => {
                let key = self.keys.get(&property.identifier).cloned();
                self.load(object.identifier, key, id)
            }
            InstructionValue::PropertyStore {
                object,
                property,
                value,
                ..
            } => {
                let values = self.values(value.identifier);
                self.store(object.identifier, Some(property.to_string()), values)
            }
            InstructionValue::ComputedStore {
                object,
                property,
                value,
                ..
            } => {
                let key = self.keys.get(&property.identifier).cloned();
                let values = self.values(value.identifier);
                self.store(object.identifier, key, values)
            }
            InstructionValue::PropertyDelete {
                object, property, ..
            } => self.store(
                object.identifier,
                Some(property.to_string()),
                Values::default(),
            ),
            InstructionValue::ComputedDelete {
                object, property, ..
            } => {
                let key = self.keys.get(&property.identifier).cloned();
                self.store(object.identifier, key, Values::default())
            }
            InstructionValue::Destructure { lvalue, value, .. } => {
                self.destructure(&lvalue.pattern, value.identifier);
                self.copy(value.identifier, id);
            }
            InstructionValue::PrefixUpdateContext { lvalue, .. }
            | InstructionValue::PostfixUpdateContext { lvalue, .. } => {
                self.values.insert(lvalue.identifier, Values::default());
                self.keys.remove(&lvalue.identifier);
                self.update_context(lvalue.identifier);
            }
            InstructionValue::CallExpression { .. }
            | InstructionValue::NewExpression { .. }
            | InstructionValue::MethodCall { .. }
            | InstructionValue::TaggedTemplateExpression { .. } => {
                self.call_result(instruction, env)
            }
            _ => {}
        }
    }
}

/// The values of the elements that `members` name by index.
fn indexed_members(elements: &Properties, members: &Members) -> FxHashSet<IdentifierId> {
    members
        .iter()
        .filter(|member| is_index(member))
        .flat_map(|member| {
            elements
                .get(&Some(member.clone()))
                .into_iter()
                .chain(elements.get(&None))
        })
        .flat_map(|values| values.identities.iter().copied())
        .collect()
}

/// Resolve async identity at each value-producing instruction. Heap properties
/// use reaching values across the CFG: a load snapshots the value before later
/// writes, and a definite store replaces the old member. Containment never makes
/// a container itself callable.
pub(super) fn infer_async_callable_contexts(
    func: &HirFunction,
    async_functions: &FxHashSet<IdentifierId>,
    captured_contexts: &Captures,
    hoisted: &FxHashMap<IdentifierId, IdentifierId>,
    function_returns: &FxHashMap<IdentifierId, ReturnedCallables>,
    env: &Environment,
) -> AsyncCallables {
    let mut result = AsyncCallables {
        identifiers: FxHashSet::default(),
        invocations: FxHashMap::default(),
        returning_callbacks: FxHashMap::default(),
        returned: ReturnedCallables::default(),
        pending_before: FxHashMap::default(),
        pending_at_exit: FxHashMap::default(),
    };
    let parameters = parameter_bindings(func, env);
    let captured_bindings: FxHashSet<IdentifierId> =
        captured_contexts.values().flatten().copied().collect();
    let mut states: FxHashMap<BlockId, CallableState> = FxHashMap::default();
    loop {
        let mut changed = false;
        for (&block_id, block) in &func.body.blocks {
            let mut predecessors = block
                .preds
                .iter()
                .filter_map(|predecessor| states.get(predecessor));
            let mut state = predecessors.next().cloned().unwrap_or_else(|| {
                let mut state = CallableState::default();
                for place in func
                    .context
                    .iter()
                    .chain(func.params.iter().map(ParamPattern::place))
                {
                    state.allocate(place.identifier);
                    state.projections.entry(place.identifier).or_default();
                    state
                        .context_values
                        .insert(place.identifier, FxHashSet::from_iter([place.identifier]));
                }
                state
            });
            for predecessor in predecessors {
                state.merge(predecessor);
            }
            for phi in &block.phis {
                let mut values = Values::default();
                let mut keys: Vec<Option<&String>> = Vec::new();
                for (predecessor, operand) in &phi.operands {
                    if let Some(predecessor) = states.get(predecessor) {
                        values.extend(&predecessor.values(operand.identifier));
                        keys.push(predecessor.keys.get(&operand.identifier));
                    }
                }
                state.values.insert(phi.place.identifier, values);
                if let Some(Some(key)) = keys.first()
                    && keys.iter().all(|other| *other == Some(*key))
                {
                    state.keys.insert(phi.place.identifier, (*key).clone());
                } else {
                    state.keys.remove(&phi.place.identifier);
                }
            }
            for &instruction_id in &block.instructions {
                let instruction = &func.instructions[instruction_id.0 as usize];
                if let InstructionValue::LoadLocal { place, .. }
                | InstructionValue::LoadContext { place, .. } = &instruction.value
                    && parameters.contains(&place.identifier)
                {
                    result
                        .returned
                        .parameter_values
                        .entry(place.identifier)
                        .or_default()
                        .extend(state.values(place.identifier).identities);
                }
                let mut invocations = Vec::new();
                let (arguments, _) = state.call_arguments(instruction, env);
                let calls: Vec<Call> = [
                    Call {
                        callees: state.invoked(&instruction.value, env),
                        arguments: Some(arguments),
                    },
                    Call {
                        callees: state.invoked_callbacks(&instruction.value, env, false),
                        arguments: state.callback_arguments(&instruction.value, env),
                    },
                ]
                .into_iter()
                .filter(|call| {
                    call.callees
                        .identities
                        .iter()
                        .any(|id| state.projections.contains_key(id))
                        || call.callees.contexts.values().any(|callable| {
                            !callable.generator
                                && (callable.is_async
                                    || callable
                                        .returned
                                        .as_ref()
                                        .is_some_and(|summary| !summary.calls.is_empty()))
                        })
                })
                .collect();
                for call in &calls {
                    state.execute_call(call, &mut FxHashSet::default(), &mut invocations);
                }
                if calls.is_empty() {
                    result.returned.calls.remove(&instruction_id);
                } else {
                    result.returned.calls.insert(instruction_id, calls);
                }
                let returning = state.invoked_callbacks(&instruction.value, env, true);
                let mut identifiers = returning.identities;
                identifiers.extend(returning.contexts.keys().copied());
                if identifiers.is_empty() {
                    result.returning_callbacks.remove(&instruction_id);
                } else {
                    result
                        .returning_callbacks
                        .insert(instruction_id, identifiers);
                }
                result.invocations.insert(instruction_id, invocations);
                if matches!(instruction.value, InstructionValue::Await { .. }) {
                    result
                        .pending_before
                        .insert(instruction_id, state.pending_observation());
                }
                state.apply(
                    instruction,
                    hoisted,
                    async_functions,
                    captured_contexts,
                    function_returns,
                    &captured_bindings,
                    env,
                );
                state.update_collection(instruction, env);
            }
            if matches!(
                block.terminal,
                Terminal::Return { .. } | Terminal::Throw { .. }
            ) {
                result
                    .pending_at_exit
                    .insert(block_id, state.pending_observation());
            }
            if states.get(&block_id) != Some(&state) {
                states.insert(block_id, state);
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    for state in states.values() {
        for (&identifier, values) in &state.values {
            if values.contexts.values().any(|callable| callable.is_async) {
                result.identifiers.insert(identifier);
            }
        }
    }
    for (block_id, block) in &func.body.blocks {
        if let Terminal::Return { value, .. } = &block.terminal
            && let Some(state) = states.get(block_id)
        {
            result
                .returned
                .values
                .extend(&state.values(value.identifier));
        }
    }
    result.returned.generator = func.generator;
    result
        .returned
        .external_contexts
        .extend(func.context.iter().map(|place| place.identifier));
    result
        .returned
        .params
        .extend(func.params.iter().map(|param| match param {
            ParamPattern::Place(place) => (place.identifier, false),
            ParamPattern::Spread(spread) => (spread.place.identifier, true),
        }));
    result.returned.capture_members = infer_capture_members(func, env, &parameters, true);
    result.returned.capture_reads = infer_capture_members(func, env, &parameters, false);
    let (eager, deferred, snapshots) = infer_capture_phases(
        func,
        &result.invocations,
        &result.returned.capture_reads,
        &parameters,
    );
    result.returned.eager_captures = eager;
    result.returned.deferred_captures = deferred;
    result.returned.snapshot_captures = snapshots;
    for calls in states.values().map(|state| &state.deferred_calls).chain(
        function_returns
            .values()
            .map(|summary| &summary.deferred_calls),
    ) {
        merge_deferred_calls(&mut result.returned.deferred_calls, calls);
    }
    for projections in states.values().map(|state| &state.projections).chain(
        function_returns
            .values()
            .map(|summary| &summary.projections),
    ) {
        for (&id, sources) in projections {
            result
                .returned
                .projections
                .entry(id)
                .or_default()
                .extend(sources.iter().cloned());
        }
    }
    result
}
