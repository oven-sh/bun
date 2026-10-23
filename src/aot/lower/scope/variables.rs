use bun_sema::atom::known;
use bun_sema::bind::{InitialState, SymbolId};
use bun_sema::check::aot::ClassRef;

use super::{BindingRef, ScopeSlot, environments};
use crate::ir::generated::{Variable, VariableFlags, VariableInitialization};
use crate::ir::{ClassSlot, DeclaredType, ModuleId, VariableId, VariableKey};
use crate::lower::{FileLowering, class, function, layouts};
use crate::modules::ModuleRef;

pub(crate) fn ensure_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    key: VariableKey,
) -> VariableId {
    let id = file.fragment.declare_variable(key);
    if key.home_file() != Some(file.file) || file.fragment.is_variable_defined(id) {
        return id;
    }
    let variable = create_variable(file, key);
    let is_defined_reentrantly = file.fragment.is_variable_defined(id);
    if !is_defined_reentrantly {
        file.fragment.define_variable(id, variable);
    }
    id
}

fn create_variable(file: &mut FileLowering<'_, '_, '_, '_>, key: VariableKey) -> Variable {
    match key {
        VariableKey::Symbol(symbol) => create_symbol_variable(file, symbol.id),
        VariableKey::ClassSlot { class, slot } => create_class_slot_variable(file, class, slot),
        VariableKey::ModulePath { variable, .. } => Variable {
            name: Some(file.intern_atom(variable.name())),
            module: file.module_id(),
            declared: DeclaredType::untyped(),
            initialization: VariableInitialization::Undefined,
            function: None,
            owner: None,
            flags: VariableFlags::default(),
        },
        VariableKey::PrivateState { part, .. } => class::create_private_state_variable(file, part),
        VariableKey::ModuleExports(_) => {
            let module = file.module_id();
            create_exports_variable(file, module)
        }
        VariableKey::InnerModuleExports(callback) => {
            let module = file.fragment.declare_module(ModuleRef::Inner {
                file: callback.file,
                callback: callback.function,
            });
            create_exports_variable(file, module)
        }
        VariableKey::SyntheticExport(_) | VariableKey::Copy(_) => {
            unreachable!("link defines the variable of an export")
        }
    }
}

// It holds `undefined` until the body of the module stores what the module exports.
fn create_exports_variable(file: &mut FileLowering<'_, '_, '_, '_>, module: ModuleId) -> Variable {
    Variable {
        name: Some(file.intern_atom(known::exports)),
        module,
        declared: DeclaredType::untyped(),
        initialization: VariableInitialization::Undefined,
        function: None,
        owner: None,
        flags: VariableFlags::default(),
    }
}

fn create_symbol_variable(file: &mut FileLowering<'_, '_, '_, '_>, symbol: SymbolId) -> Variable {
    let bound = file.bound;
    let binding = BindingRef::Symbol(symbol);
    let name = file.intern_atom(bound.symbol(symbol).name);
    let declared = environments::location_position(file, binding);
    let (initialization, function) = match file.scopes.initial_function(symbol) {
        Some(source) => {
            let function = function::declare_source_function(file, source, None);
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
        module: file.module_id(),
        declared,
        initialization,
        function,
        owner: None,
        flags: compute_flags(file, binding),
    }
}

fn create_class_slot_variable(
    file: &mut FileLowering<'_, '_, '_, '_>,
    class: ClassRef,
    slot: ClassSlot,
) -> Variable {
    let scope = file.bound.class_scope[class.class.idx()];
    let binding = BindingRef::Slot(scope, ScopeSlot::Class(slot));
    let declared = environments::location_position(file, binding);
    let owner = match slot {
        ClassSlot::StaticField(member) if class::has_private_static_storage(file.hir, member) => {
            None
        }
        ClassSlot::StaticField(_) => Some(layouts::class_layout(file, class)),
        _ => None,
    };
    Variable {
        name: None,
        module: file.module_id(),
        declared,
        initialization: VariableInitialization::Uninitialized,
        function: None,
        owner,
        flags: compute_flags(file, binding),
    }
}

fn compute_flags(file: &FileLowering<'_, '_, '_, '_>, binding: BindingRef) -> VariableFlags {
    match file.scopes.placement(binding) {
        Some(placement) if placement.is_immutable => VariableFlags::IS_IMMUTABLE,
        Some(_) | None => VariableFlags::default(),
    }
}
