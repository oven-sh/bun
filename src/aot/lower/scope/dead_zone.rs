use bun_sema::atom::Atom;
use bun_sema::bind::{InitialState, ScopeId, ScopeKind, SymbolId};

use super::{BindingRef, DeadZone, ScopeSlot, bindings};
use crate::ir::{ClassSlot, DeclaredType, TypeTable, ValueId};
use crate::lower::{FileLowering, FunctionLowering, class, function};

pub(super) fn has_dead_zone(file: &FileLowering<'_, '_, '_, '_>, binding: BindingRef) -> bool {
    match binding {
        BindingRef::Symbol(symbol) => match file.bound.initial_state(symbol) {
            InitialState::Uninitialized => true,
            InitialState::Undefined | InitialState::Initialized => false,
        },
        BindingRef::Slot(scope, ScopeSlot::This) => is_derived_constructor_scope(file, scope),
        BindingRef::Slot(_, ScopeSlot::Class(ClassSlot::StaticField(member))) => {
            class::has_private_static_storage(file.hir, member)
        }
        BindingRef::Slot(
            _,
            ScopeSlot::NewTarget
            | ScopeSlot::Callee
            | ScopeSlot::HomeObject
            | ScopeSlot::Arguments
            | ScopeSlot::ArgumentsBinding
            | ScopeSlot::CommonJs(_)
            | ScopeSlot::WithObject
            | ScopeSlot::EvalVariables
            | ScopeSlot::Class(
                ClassSlot::ClassObject
                | ClassSlot::ClassToken
                | ClassSlot::ComputedKey(_)
                | ClassSlot::PrivateMethod(_)
                | ClassSlot::DecoratorState,
            ),
        ) => false,
    }
}

fn is_derived_constructor_scope(file: &FileLowering<'_, '_, '_, '_>, scope: ScopeId) -> bool {
    match file.bound.scopes[scope.idx()].kind {
        ScopeKind::Fn(function) => function::is_derived_constructor(file, function),
        _ => false,
    }
}

pub(super) fn add_absent(
    file: &mut FileLowering<'_, '_, '_, '_>,
    mut position: DeclaredType,
) -> DeclaredType {
    position.ty = file.fragment.types.union(position.ty, TypeTable::ABSENT);
    position
}

pub(super) fn get_checked(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
) -> ValueId {
    let binding = BindingRef::Symbol(symbol);
    let Some(local) = lowering.scopes.find_local(binding) else {
        if lowering
            .file
            .scopes
            .is_initialized_holder(lowering.key, symbol)
        {
            return lowering.builder.boolean(true);
        }
        let value = bindings::get_stored(lowering, binding);
        if !has_dead_zone(lowering.file, binding) {
            return value;
        }
        return emit_initialization_check(lowering, value, name);
    };
    match local.dead_zone {
        DeadZone::Never | DeadZone::Initialized => lowering.builder.read_variable(local.variable),
        DeadZone::Uninitialized => {
            let absent = lowering.builder.absent();
            emit_initialization_check(lowering, absent, name)
        }
        DeadZone::DecidedAtRunTime => {
            let value = lowering.builder.read_variable(local.variable);
            let checked = emit_initialization_check(lowering, value, name);
            lowering.builder.write_variable(local.variable, checked);
            checked
        }
    }
}

pub(super) fn check_before_store(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
) {
    let binding = BindingRef::Symbol(symbol);
    if !has_dead_zone(lowering.file, binding) {
        return;
    }
    let local = lowering.scopes.find_local(binding);
    match local.map(|local| local.dead_zone) {
        Some(DeadZone::Never | DeadZone::Initialized) => {}
        Some(DeadZone::Uninitialized | DeadZone::DecidedAtRunTime) | None => {
            get_checked(lowering, symbol, name);
        }
    }
}

pub(super) fn is_tested_before_value(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
) -> bool {
    let binding = BindingRef::Symbol(symbol);
    let placement = lowering.file.scopes.placement(binding);
    has_dead_zone(lowering.file, binding) && placement.is_some_and(|placement| placement.is_shared)
}

fn emit_initialization_check(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
    name: Atom,
) -> ValueId {
    let name = lowering.file.intern_atom(name);
    lowering.builder.check_initialized(value, name)
}
