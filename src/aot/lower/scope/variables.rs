use bun_sema::atom::{Atom, known};
use bun_sema::bind::{InitialState, SymbolId};
use bun_sema::check::aot::ClassRef;

use super::{BindingRef, ScopeSlot};
use crate::ir::generated::{Variable, VariableFlags, VariableInitialization};
use crate::ir::{ClassSlot, DeclaredType, VariableId, VariableKey};
use crate::lower::{FileLowering, class, function};
use crate::modules::ModuleRef;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn ensure_variable(&mut self, key: VariableKey) -> VariableId {
        let id = self.fragment.declare_variable(key);
        if key.home_file() != Some(self.file) || self.fragment.is_variable_defined(id) {
            return id;
        }
        let variable = match key {
            VariableKey::Symbol(symbol) => self.create_symbol_variable(symbol.id),
            VariableKey::ClassSlot { class, slot } => self.create_class_slot_variable(class, slot),
            VariableKey::ModulePath { variable, .. } => {
                self.create_untyped_variable(variable.name())
            }
            VariableKey::PrivateState { part, .. } => self.create_private_state_variable(part),
            VariableKey::ModuleExports(_) => self.create_untyped_variable(known::exports),
            VariableKey::InnerModuleExports(callback) => {
                let module = self.fragment.declare_module(ModuleRef::Inner {
                    file: callback.file,
                    callback: callback.function,
                });
                Variable {
                    module,
                    ..self.create_untyped_variable(known::exports)
                }
            }
            VariableKey::SyntheticExport(_) | VariableKey::Copy(_) => {
                unreachable!("link defines the variable of an export")
            }
        };
        let is_defined_reentrantly = self.fragment.is_variable_defined(id);
        if !is_defined_reentrantly {
            self.fragment.define_variable(id, variable);
        }
        id
    }

    // It holds `undefined` until the body of the module stores into it.
    fn create_untyped_variable(&mut self, name: Atom) -> Variable {
        Variable {
            name: Some(self.intern_atom(name)),
            module: self.module_id(),
            declared: DeclaredType::untyped(),
            initialization: VariableInitialization::Undefined,
            ..Variable::default()
        }
    }

    fn create_symbol_variable(&mut self, symbol: SymbolId) -> Variable {
        let bound = self.bound;
        let binding = BindingRef::Symbol(symbol);
        let name = self.intern_atom(bound.symbol(symbol).name);
        let declared = self.location_position(binding);
        let (initialization, function) = match self.scopes.initial_function(symbol) {
            Some(source) => {
                let function = function::declare_source_function(self, source, None);
                (VariableInitialization::Function, Some(function))
            }
            None => match bound.initial_state(symbol) {
                InitialState::Undefined => (VariableInitialization::Undefined, None),
                InitialState::Uninitialized | InitialState::Initialized => {
                    (VariableInitialization::Uninitialized, None)
                }
            },
        };
        Variable {
            name: Some(name),
            module: self.module_id(),
            declared,
            initialization,
            function,
            owner: None,
            flags: self.compute_flags(binding),
        }
    }

    fn create_class_slot_variable(&mut self, class: ClassRef, slot: ClassSlot) -> Variable {
        let scope = self.bound.class_scope[class.class.idx()];
        let binding = BindingRef::Slot(scope, ScopeSlot::Class(slot));
        let declared = self.location_position(binding);
        let owner = match slot {
            ClassSlot::StaticField(member)
                if !class::has_private_static_storage(self.hir, member) =>
            {
                Some(self.class_layout(class))
            }
            _ => None,
        };
        Variable {
            module: self.module_id(),
            declared,
            initialization: VariableInitialization::Uninitialized,
            owner,
            flags: self.compute_flags(binding),
            ..Variable::default()
        }
    }

    fn compute_flags(&self, binding: BindingRef) -> VariableFlags {
        match self.scopes.placement(binding) {
            Some(placement) if placement.is_immutable => VariableFlags::IS_IMMUTABLE,
            Some(_) | None => VariableFlags::default(),
        }
    }
}
