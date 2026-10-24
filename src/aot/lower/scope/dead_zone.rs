use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, InitialState, ScopeKind, SymbolId};

use super::{BindingRef, DeadZone, ScopeSlot};
use crate::ir::{ClassSlot, ValueId};
use crate::lower::{FileLowering, FunctionLowering, class};

pub(super) fn has_dead_zone(file: &FileLowering<'_, '_, '_, '_>, binding: BindingRef) -> bool {
    match binding {
        BindingRef::Symbol(symbol) => match file.bound.initial_state(symbol) {
            InitialState::Uninitialized => true,
            InitialState::Undefined | InitialState::Initialized => false,
        },
        BindingRef::Slot(scope, ScopeSlot::This) => match file.bound.scopes[scope.idx()].kind {
            ScopeKind::Fn(function) => file.is_derived_constructor(function),
            _ => false,
        },
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(super) fn get_checked(&mut self, symbol: SymbolId, name: Atom) -> ValueId {
        let binding = BindingRef::Symbol(symbol);
        let Some(local) = self.scopes.find_local(binding) else {
            if self.file.scopes.is_initialized_holder(self.key, symbol) {
                return self.builder.boolean(true);
            }
            let value = self.get_stored(binding);
            if !has_dead_zone(self.file, binding) {
                return value;
            }
            return self.emit_initialization_check(value, symbol, name);
        };
        match local.dead_zone {
            DeadZone::Never | DeadZone::Initialized => self.builder.read_variable(local.variable),
            DeadZone::Uninitialized => {
                let absent = self.builder.absent();
                self.emit_initialization_check(absent, symbol, name)
            }
            DeadZone::DecidedAtRunTime => {
                let value = self.builder.read_variable(local.variable);
                let checked = self.emit_initialization_check(value, symbol, name);
                self.builder.write_variable(local.variable, checked);
                checked
            }
        }
    }

    pub(super) fn check_before_store(&mut self, symbol: SymbolId, name: Atom) {
        let binding = BindingRef::Symbol(symbol);
        if !has_dead_zone(self.file, binding) {
            return;
        }
        let local = self.scopes.find_local(binding);
        match local.map(|local| local.dead_zone) {
            Some(DeadZone::Never | DeadZone::Initialized) => {}
            Some(DeadZone::Uninitialized | DeadZone::DecidedAtRunTime) | None => {
                self.get_checked(symbol, name);
            }
        }
    }

    pub(super) fn is_tested_before_value(&self, symbol: SymbolId) -> bool {
        let binding = BindingRef::Symbol(symbol);
        let placement = self.file.scopes.placement(binding);
        has_dead_zone(self.file, binding) && placement.is_some_and(|placement| placement.is_shared)
    }

    fn emit_initialization_check(
        &mut self,
        value: ValueId,
        symbol: SymbolId,
        name: Atom,
    ) -> ValueId {
        let binding = Binding::Symbol(symbol);
        let name = self.file.intern_binding_name(binding, name);
        self.builder.check_initialized(value, name)
    }
}
