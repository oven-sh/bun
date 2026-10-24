use bun_sema::bind::{CodeUnit, ScopeId, SymbolId};
use bun_sema::check::aot::ClassRef;
use bun_sema::hir::{Flags, FnId, FnKind, MemberId, MemberKind};
use bun_sema::util::SharedSort;

use super::{Context, Parts, Placements};
use crate::ir::FunctionKey;
use crate::ir::generated::FunctionFlags;
use crate::lower::captures::Capture;
use crate::lower::scope::analysis::{
    FunctionSummary, GroupedList, LoopStores, ScopeAnalysis, find_by_key,
};
use crate::lower::scope::lexical_owners::scope_chain;
use crate::lower::scope::walk::{ArgumentRead, WalkedLoop};
use crate::lower::scope::{ArgumentsObject, BindingForm, BindingRef, ScopeSlot, WalkedFunctionId};

pub(super) fn build_analysis(context: &Context<'_, '_>, parts: Parts) -> ScopeAnalysis {
    let walk = context.walk;
    let (functions, captures) = compute_function_summaries(context, &parts);
    let symbols = (0..).map(SymbolId).zip(&parts.forms);
    let stored = symbols.filter(|entry| *entry.1 == BindingForm::Stored);
    let stored = stored.map(|(symbol, _)| {
        let scope = context.declaring_scope(symbol);
        (scope, BindingRef::Symbol(symbol))
    });
    let slots = parts.placements.slots.iter();
    let slots = slots.map(|&((scope, slot), _)| (scope, BindingRef::Slot(scope, slot)));
    let hoisted = walk.hoisted_functions.iter();
    let hoisted = hoisted.map(|&(scope, symbol, function)| (scope, (symbol, function)));
    let switch_scopes = (0..).map(ScopeId).zip(&walk.is_switch_scope);
    let switch_scopes = switch_scopes.filter(|entry| *entry.1).map(|entry| entry.0);
    let holders = parts.initialized_holders.iter();
    let holders = holders.map(|&(function, symbol)| (walk.functions[function.index()].key, symbol));
    let mut initialized_holders: Vec<(FunctionKey, SymbolId)> = holders.collect();
    initialized_holders.sort_unstable();
    ScopeAnalysis {
        file: context.input.file,
        max_captures: context.input.max_captures,
        bindings: group_by_scope(context, stored.chain(slots)),
        environment_fields: group_by_scope(context, parts.placements.fields.iter().copied()),
        hoisted_functions: group_by_scope(context, hoisted),
        switch_scopes: switch_scopes.collect(),
        functions,
        captures,
        loops: compute_loop_stores(context, &parts.forms, &parts.placements),
        field_initializers: find_field_initializers(context),
        forms: parts.forms,
        symbol_placements: parts.placements.symbols,
        slot_placements: parts.placements.slots,
        initial_functions: parts.placements.initial_functions,
        lexical_owners: parts.lexical_owners,
        arguments_objects: parts.arguments_objects,
        initialized_holders,
        has_wrapper_parameters: walk.has_wrapper_parameters,
    }
}

fn group_by_scope<T: Copy>(
    context: &Context<'_, '_>,
    entries: impl Iterator<Item = (ScopeId, T)>,
) -> GroupedList<T> {
    let entries = entries.map(|(scope, item)| (scope.idx(), item));
    let entries: Vec<(usize, T)> = entries.collect();
    GroupedList::new(context.input.bound.scopes.len(), &entries)
}

fn has_slot(placements: &Placements, scope: ScopeId, slot: ScopeSlot) -> bool {
    find_by_key(&placements.slots, (scope, slot)).is_some()
}

fn has_local(forms: &[BindingForm], placements: &Placements, binding: BindingRef) -> bool {
    match binding {
        BindingRef::Symbol(symbol) => {
            forms[symbol.idx()] == BindingForm::Stored && placements.symbols[symbol.idx()].has_local
        }
        BindingRef::Slot(scope, slot) => {
            let placement = find_by_key(&placements.slots, (scope, slot));
            placement.is_some_and(|placement| placement.has_local)
        }
    }
}

// A scope has a greater number than the scope around it.
fn encloses(context: &Context<'_, '_>, outer: ScopeId, inner: ScopeId) -> bool {
    scope_chain(context.input.bound, inner).find(|&scope| scope <= outer) == Some(outer)
}

fn compute_loop_stores(
    context: &Context<'_, '_>,
    forms: &[BindingForm],
    placements: &Placements,
) -> LoopStores {
    let mut loops: Vec<&WalkedLoop> = context.walk.loops.iter().collect();
    loops.shared_sort_unstable_by_key(|walked| walked.statement);
    let mut stored = Vec::new();
    for (index, &walked) in loops.iter().enumerate() {
        let is_loop_carried = |binding: &BindingRef| {
            has_local(forms, placements, *binding)
                && context.owner_of(*binding) == Some(walked.function)
                && encloses(context, context.scope_of(*binding), walked.boundary)
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
    let over_limit = &parts.captures.functions_over_limit;
    let mut summaries = Vec::with_capacity(functions.len());
    let mut captures = Vec::new();
    for (id, function) in (0..).map(WalkedFunctionId).zip(functions) {
        let start = captures.len() as u32;
        captures.extend_from_slice(&parts.captures.captures[id.index()]);
        summaries.push(FunctionSummary {
            key: function.key,
            entry_flags: compute_entry_flags(context, function.key, parts),
            undeclared_parameters: count_undeclared_parameters(context, function.key),
            captures: start..captures.len() as u32,
            has_too_many_captures: over_limit.binary_search(&id).is_ok(),
        });
    }
    summaries.sort_unstable_by_key(|summary| summary.key);
    debug_assert!(summaries.is_sorted_by(|first, second| first.key < second.key));
    (summaries, captures)
}

fn argument_reads(context: &Context<'_, '_>, function: FnId) -> impl Iterator<Item = ArgumentRead> {
    let walked = context.walk.function_of_fn[function.idx()];
    let reads = context.walk.argument_reads.iter();
    let reads = reads.filter(move |read| Some(read.0) == walked);
    reads.map(|read| read.1)
}

fn count_undeclared_parameters(context: &Context<'_, '_>, key: FunctionKey) -> u32 {
    let FunctionKey::Source(source) = key else {
        return 0;
    };
    let positions = argument_reads(context, source.function).filter_map(|read| match read {
        ArgumentRead::Count => None,
        ArgumentRead::At(position) => Some(position + 1),
    });
    if has_rest_parameter(context, source.function) {
        return 0;
    }
    let declared = context.input.hir[source.function].params.len;
    positions.max().unwrap_or(0).saturating_sub(declared)
}

fn has_rest_parameter(context: &Context<'_, '_>, function: FnId) -> bool {
    let hir = context.input.hir;
    let last = hir[function].params.iter().next_back();
    last.is_some_and(|last| hir[last].flags.contains(Flags::REST))
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
        FunctionKey::WrappedModuleBody(_)
        | FunctionKey::FaceBody(_)
        | FunctionKey::CheckBody(_) => {
            unreachable!("the walk meets no function of this kind")
        }
        FunctionKey::Source(source) => compute_source_entry_flags(context, source.function, parts),
        FunctionKey::Signature(_) | FunctionKey::ClassSignature(_) => {
            unreachable!("a signature has no scopes")
        }
        FunctionKey::ImplicitConstructor(_) => FunctionFlags::HAS_NEW_TARGET,
        _ => FunctionFlags::HAS_THIS,
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
    let top = context.input.bound.fns[function.idx()].scope;
    let has = |slot: ScopeSlot| has_slot(&parts.placements, top, slot);
    let kind = context.input.hir.runtime_function_kind(function);
    let is_constructor = kind == FnKind::Constructor;
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
    if has_rest_parameter(context, function) {
        flags = flags.without(FunctionFlags::HAS_HIDDEN_REST);
    }
    flags
}

fn find_field_initializers(context: &Context<'_, '_>) -> Vec<(MemberId, FunctionKey)> {
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
    field_initializers
}
