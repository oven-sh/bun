use bun_sema::bind::{CodeUnit, ScopeId, SymbolId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{Flags, FnId, FnKind, MemberId, MemberKind};

use super::storage::find_initial_functions;
use super::{Context, Parts, Placements};
use crate::ir::generated::FunctionFlags;
use crate::ir::{FunctionKey, VariableKey};
use crate::lower::captures::Capture;
use crate::lower::scope::analysis::{
    ClassUnits, FunctionSummary, GroupedList, LoopStores, ScopeAnalysis, find_by_key,
};
use crate::lower::scope::walk::{ArgumentRead, WalkedLoop};
use crate::lower::scope::{
    ArgumentsObject, BindingForm, BindingRef, ScopeSlot, Storage, WalkedFunctionId,
};

pub(super) fn build_analysis(context: &Context<'_, '_>, parts: Parts) -> ScopeAnalysis {
    let variables = collect_symbol_variables(&parts.placements);
    let (functions, captures) = compute_function_summaries(context, &parts);
    ScopeAnalysis {
        file: context.input.file,
        bindings: group_bindings(context, &parts.forms, &parts.placements),
        environment_fields: group_fields(context, &parts.placements),
        hoisted_functions: group_hoisted_functions(context),
        initial_functions: find_initial_functions(context, &variables, &parts.captures),
        switch_scopes: collect_switch_scopes(context),
        functions,
        captures,
        loops: compute_loop_stores(context, &parts.forms, &parts.placements),
        class_units: find_class_units(context),
        forms: parts.forms,
        symbol_placements: parts.placements.symbols,
        slot_placements: parts.placements.slots,
        lexical_owners: parts.lexical_owners,
        arguments_objects: parts.arguments_objects,
        initialized_holders: name_initialized_holders(context, &parts.initialized_holders),
        has_wrapper_parameters: context.walk.has_wrapper_parameters,
    }
}

fn name_initialized_holders(
    context: &Context<'_, '_>,
    holders: &[(WalkedFunctionId, SymbolId)],
) -> Vec<(FunctionKey, SymbolId)> {
    let key_of = |function: WalkedFunctionId| context.walk.functions[function.index()].key;
    let named = holders.iter().map(|&(function, symbol)| (key_of(function), symbol));
    let mut named: Vec<(FunctionKey, SymbolId)> = named.collect();
    named.sort_unstable();
    named
}

fn is_stored_form(form: BindingForm) -> bool {
    match form {
        BindingForm::Stored => true,
        BindingForm::NotAValue
        | BindingForm::Import
        | BindingForm::Callee { .. }
        | BindingForm::MappedArgument { .. }
        | BindingForm::ContainerMember { .. } => false,
    }
}

fn has_slot(placements: &Placements, scope: ScopeId, slot: ScopeSlot) -> bool {
    find_by_key(&placements.slots, (scope, slot)).is_some()
}

fn has_local(forms: &[BindingForm], placements: &Placements, binding: BindingRef) -> bool {
    match binding {
        BindingRef::Symbol(symbol) => {
            is_stored_form(forms[symbol.idx()]) && placements.symbols[symbol.idx()].has_local
        }
        BindingRef::Slot(scope, slot) => {
            let placement = find_by_key(&placements.slots, (scope, slot));
            placement.is_some_and(|placement| placement.has_local)
        }
    }
}

fn group_bindings(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    placements: &Placements,
) -> GroupedList<BindingRef> {
    let mut entries: Vec<(usize, BindingRef)> = Vec::new();
    for (symbol, &form) in (0..).map(SymbolId).zip(forms) {
        if is_stored_form(form) {
            entries.push((context.declaring_scope(symbol).idx(), BindingRef::Symbol(symbol)));
        }
    }
    for &((scope, slot), _) in &placements.slots {
        entries.push((scope.idx(), BindingRef::Slot(scope, slot)));
    }
    GroupedList::new(context.input.bound.scopes.len(), &entries)
}

fn group_fields(context: &Context<'_, '_>, placements: &Placements) -> GroupedList<BindingRef> {
    let fields = placements.fields.iter();
    let entries = fields.map(|&(scope, binding)| (scope.idx(), binding));
    GroupedList::new(context.input.bound.scopes.len(), &entries.collect::<Vec<_>>())
}

fn group_hoisted_functions(context: &Context<'_, '_>) -> GroupedList<(SymbolId, FnId)> {
    let functions = context.walk.hoisted_functions.iter();
    let entries = functions.map(|&(scope, symbol, function)| (scope.idx(), (symbol, function)));
    GroupedList::new(context.input.bound.scopes.len(), &entries.collect::<Vec<_>>())
}

fn collect_symbol_variables(placements: &Placements) -> Vec<(BindingRef, VariableKey)> {
    let mut variables = Vec::new();
    for (symbol, placement) in (0..).map(SymbolId).zip(&placements.symbols) {
        match placement.storage {
            Storage::Variable(key) => variables.push((BindingRef::Symbol(symbol), key)),
            Storage::Local | Storage::Field { .. } => {}
        }
    }
    variables
}

fn collect_switch_scopes(context: &Context<'_, '_>) -> Vec<ScopeId> {
    let scopes = (0..).map(ScopeId).zip(&context.walk.is_switch_scope);
    let switch_scopes = scopes.filter(|entry| *entry.1);
    switch_scopes.map(|entry| entry.0).collect()
}

fn compute_scope_depths(context: &Context<'_, '_>) -> Vec<u32> {
    let scopes = &context.input.bound.scopes;
    let mut depths: Vec<u32> = Vec::with_capacity(scopes.len());
    for (index, scope) in scopes.iter().enumerate() {
        let parent = scope.parent.some().map(ScopeId::idx);
        debug_assert!(parent.is_none_or(|parent| parent < index));
        let depth = parent.map_or(0, |parent| depths[parent] + 1);
        depths.push(depth);
    }
    depths
}

fn encloses(context: &Context<'_, '_>, depths: &[u32], outer: ScopeId, inner: ScopeId) -> bool {
    let depth_of = |scope: ScopeId| depths.get(scope.idx());
    let mut scope = inner;
    while depth_of(scope) > depth_of(outer) {
        scope = context.input.bound.scopes[scope.idx()].parent;
    }
    scope == outer
}

fn compute_loop_stores(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    placements: &Placements,
) -> LoopStores {
    let depths = compute_scope_depths(context);
    let mut loops: Vec<&WalkedLoop> = context.walk.loops.iter().collect();
    loops.sort_unstable_by_key(|walked| walked.statement);
    let mut stored = Vec::new();
    for (index, &walked) in loops.iter().enumerate() {
        let is_loop_carried = |binding: &BindingRef| {
            has_local(forms, placements, *binding)
                && context.owner_of(*binding) == Some(walked.function)
                && encloses(context, &depths, context.scope_of(*binding), walked.boundary)
        };
        let bindings = walked.stored.iter().copied().filter(is_loop_carried);
        stored.extend(bindings.map(|binding| (index, binding)));
    }
    LoopStores {
        statements: loops.iter().map(|walked| walked.statement).collect(),
        stored: GroupedList::new(loops.len(), &stored),
    }
}

fn compute_function_summaries(
    context: &Context<'_, '_>,
    parts: &Parts,
) -> (Vec<FunctionSummary>, Vec<Capture>) {
    let functions = &context.walk.functions;
    debug_assert_eq!(functions.len(), parts.captures.captures.len());
    let mut summaries = Vec::with_capacity(functions.len());
    let mut captures = Vec::new();
    for (id, function) in (0..).map(WalkedFunctionId).zip(functions) {
        let start = captures.len() as u32;
        captures.extend_from_slice(&parts.captures.captures[id.index()]);
        let is_over_limit = parts.captures.functions_over_limit.binary_search(&id).is_ok();
        summaries.push(FunctionSummary {
            key: function.key,
            entry_flags: compute_entry_flags(context, function.key, parts),
            undeclared_parameters: count_undeclared_parameters(context, function.key),
            captures: start..captures.len() as u32,
            has_too_many_captures: is_over_limit,
        });
    }
    summaries.sort_unstable_by_key(|summary| summary.key);
    debug_assert!(summaries.is_sorted_by(|first, second| first.key < second.key));
    (summaries, captures)
}

fn argument_reads(
    context: &Context<'_, '_>,
    function: FnId,
) -> impl Iterator<Item = ArgumentRead> {
    let walked = context.walk.function_of_fn[function.idx()];
    let reads = context.walk.argument_reads.iter();
    reads.filter(move |read| Some(read.0) == walked).map(|read| read.1)
}

fn count_undeclared_parameters(context: &Context<'_, '_>, key: FunctionKey) -> u32 {
    let FunctionKey::Source(source) = key else {
        return 0;
    };
    let positions = argument_reads(context, source.function).filter_map(|read| match read {
        ArgumentRead::Count => None,
        ArgumentRead::At(position) => Some(position + 1),
    });
    let hir = context.input.hir;
    let declared = hir[source.function].params;
    if declared.iter().next_back().is_some_and(|last| hir[last].flags.contains(Flags::REST)) {
        return 0;
    }
    positions.max().unwrap_or(0).saturating_sub(declared.len)
}

fn compute_entry_flags(
    context: &Context<'_, '_>,
    key: FunctionKey,
    parts: &Parts,
) -> FunctionFlags {
    match key {
        FunctionKey::ModuleBody(_) => {
            let has = |slot: ScopeSlot| has_slot(&parts.placements, context.file_scope, slot);
            let mut flags = compute_arguments_entry_flags(parts, CodeUnit::File);
            // Nobody passes `this` to the body of a module. What `this` stands for there is stored when the scope is entered.
            if has(ScopeSlot::This) && context.walk.has_wrapper_parameters {
                flags |= FunctionFlags::HAS_THIS;
            }
            if has(ScopeSlot::Callee) {
                flags |= FunctionFlags::TAKES_CALLEE;
            }
            flags
        }
        FunctionKey::WrappedModuleBody(_) | FunctionKey::FaceBody(_) | FunctionKey::CheckBody(_) => {
            unreachable!("the walk meets no function of this kind")
        }
        FunctionKey::Source(source) => compute_source_entry_flags(context, source.function, parts),
        FunctionKey::Signature(_) | FunctionKey::ClassSignature(_) => {
            unreachable!("a signature has no scopes")
        }
        FunctionKey::ImplicitConstructor(_) => FunctionFlags::HAS_NEW_TARGET,
        FunctionKey::InstanceInitializer(_)
        | FunctionKey::StaticInitializer(_)
        | FunctionKey::AccessorGetter { .. }
        | FunctionKey::AccessorSetter { .. }
        | FunctionKey::PrivateNameTest { .. } => FunctionFlags::HAS_THIS,
    }
}

fn compute_arguments_entry_flags(parts: &Parts, unit: CodeUnit) -> FunctionFlags {
    match parts.arguments_objects.get(unit) {
        ArgumentsObject::None => FunctionFlags::default(),
        ArgumentsObject::Unmapped | ArgumentsObject::Mapped => {
            FunctionFlags::HAS_ARGUMENT_COUNT | FunctionFlags::HAS_HIDDEN_REST
        }
    }
}

fn compute_source_entry_flags(
    context: &Context<'_, '_>,
    function: FnId,
    parts: &Parts,
) -> FunctionFlags {
    let hir = context.input.hir;
    let func = hir[function];
    let top = context.input.bound.fns[function.idx()].scope;
    let has = |slot: ScopeSlot| has_slot(&parts.placements, top, slot);
    let is_constructor = hir.runtime_function_kind(function) == FnKind::Constructor;
    let mut flags = compute_arguments_entry_flags(parts, CodeUnit::Function(function));
    if argument_reads(context, function).any(|read| read == ArgumentRead::Count) {
        flags |= FunctionFlags::HAS_ARGUMENT_COUNT;
    }
    if has(ScopeSlot::This) && !is_constructor {
        flags |= FunctionFlags::HAS_THIS;
    }
    if has(ScopeSlot::NewTarget) || is_constructor {
        flags |= FunctionFlags::HAS_NEW_TARGET;
    }
    if has(ScopeSlot::Callee) {
        flags |= FunctionFlags::TAKES_CALLEE;
    }
    let last_parameter = func.params.iter().next_back();
    if last_parameter.is_some_and(|parameter| hir[parameter].flags.contains(Flags::REST)) {
        flags = flags.without(FunctionFlags::HAS_HIDDEN_REST);
    }
    flags
}

fn find_class_units(context: &Context<'_, '_>) -> ClassUnits {
    let (file, hir, bound) = (context.input.file, context.input.hir, context.input.bound);
    let mut field_initializers = Vec::new();
    for (member, node) in (0..).map(MemberId).zip(hir.members.iter()) {
        let Some(class) = bound.member_class(member) else {
            continue;
        };
        if node.kind == MemberKind::StaticBlock || bound.field_initializer_scope(member).is_none() {
            continue;
        }
        let class = ClassRef { file, class };
        let initializer = if node.flags.contains(Flags::STATIC) {
            FunctionKey::StaticInitializer(class)
        } else {
            FunctionKey::InstanceInitializer(class)
        };
        field_initializers.push((member, initializer));
    }
    ClassUnits { field_initializers }
}
