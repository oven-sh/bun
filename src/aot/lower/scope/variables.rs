use bun_sema::atom::{Atom, known};
use bun_sema::bind::{BindingKind, InitialState, SymbolId};
use bun_sema::check::aot::{ClassRef, FunctionRef};
use bun_sema::hir::{ExprId, ExprKind};
use bun_sema::program::Sym;

use super::{BindingRef, ScopeSlot};
use crate::ir::generated::{Variable, VariableFlags, VariableInitialization};
use crate::ir::{ClassSlot, DeclaredType, TypeTable, VariableId, VariableKey};
use crate::lower::{FileLowering, class, function};
use crate::modules::ModuleRef;

impl FileLowering<'_, '_, '_, '_> {
    pub(crate) fn ensure_variable(&mut self, key: VariableKey) -> VariableId {
        let id = self.fragment.declare_variable(key);
        if key.home_file() != Some(self.file) || self.fragment.is_variable_defined(id) {
            return id;
        }
        let variable = match key {
            VariableKey::Symbol(symbol)
                if self.bound.binding_kind(symbol.id) == BindingKind::Import =>
            {
                self.create_untyped_variable(self.bound.symbol(symbol.id).name)
            }
            VariableKey::Symbol(symbol) => self.create_symbol_variable(symbol.id),
            VariableKey::FunctionMember { function, store } => {
                self.create_function_member_variable(function, store)
            }
            VariableKey::ClassSlot { class, slot } => self.create_class_slot_variable(class, slot),
            VariableKey::ModulePath { variable, .. } => {
                self.create_untyped_variable(variable.name())
            }
            VariableKey::PrivateState { part, .. } => self.create_private_state_variable(part),
            VariableKey::ModuleExports(_) => self.create_untyped_variable(known::exports),
            VariableKey::RequiredAnswer(_) => {
                let mut declared = DeclaredType::untyped();
                declared.ty = self.fragment.types.union(declared.ty, TypeTable::ABSENT);
                Variable {
                    declared,
                    initialization: VariableInitialization::Uninitialized,
                    ..self.create_untyped_variable(known::default)
                }
            }
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

    fn create_function_member_variable(
        &mut self,
        function: FunctionRef,
        store: ExprId,
    ) -> Variable {
        let ExprKind::Assign { target, .. } = self.hir[store].kind else {
            unreachable!("a member of a function is stored by an assignment");
        };
        let ExprKind::Dot { name, .. } = self.hir[target].kind else {
            unreachable!("a member of a function is stored under its name");
        };
        Variable {
            initialization: VariableInitialization::Uninitialized,
            owner: self.declare_constructor_function_layout(function),
            ..self.create_untyped_variable(name)
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
        match (self.scopes.placement(binding), binding) {
            (Some(placement), _) if placement.is_immutable => VariableFlags::IS_IMMUTABLE,
            (_, BindingRef::Symbol(symbol)) if self.is_replaceable(symbol) => {
                VariableFlags::IS_REPLACEABLE
            }
            _ => VariableFlags::default(),
        }
    }

    pub(super) fn is_replaceable(&self, id: SymbolId) -> bool {
        let file = self.file;
        self.inputs.modules.is_replaceable(Sym { file, id })
    }
}
