use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingKind, CodeUnit, SymbolId};
use bun_sema::hir::{ExprId, FnId};

use super::lexical_owners::find_container_binding;
use super::{
    BindingForm, BindingRef, ScopeSlot, Storage, dead_zone, environments, identifiers, variables,
};
use crate::ir::ValueId;
use crate::ir::generated::{ECMAMode, RuntimeErrorKind};
use crate::lower::captures::{self, Capture};
use crate::lower::member::{self, PropertyName};
use crate::lower::{
    FileLowering, FunctionLowering, commonjs, convert, exception, function, module, positions,
};

#[derive(Copy, Clone, PartialEq, Eq)]
enum BindingStore {
    Initialize,
    Assign,
}

fn code_unit_slot(
    file: &FileLowering<'_, '_, '_, '_>,
    unit: CodeUnit,
    slot: ScopeSlot,
) -> BindingRef {
    BindingRef::Slot(file.bound.top_scope(file.hir, unit), slot)
}

// Only the text of a CommonJS file that keeps the five names as parameters is a function with an arguments object.
pub(super) fn normalize_binding(file: &FileLowering<'_, '_, '_, '_>, binding: Binding) -> Binding {
    match binding {
        Binding::Arguments(CodeUnit::File) if !file.scopes.has_wrapper_parameters() => {
            Binding::Free
        }
        Binding::Symbol(_) | Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
            binding
        }
    }
}

pub(in crate::lower) fn get_stored(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: BindingRef,
) -> ValueId {
    if let Some(local) = lowering.scopes.find_local(binding) {
        return lowering.builder.read_variable(local.variable);
    }
    if let Some(value) = captures::find_captured_value(lowering, Capture::Value(binding)) {
        return value;
    }
    let placement = lowering.file.scopes.placement(binding);
    let placement = placement.expect("the scope walk records every binding that is read");
    match placement.storage {
        Storage::Field { scope, field } => {
            let environment = environments::get_environment(lowering, scope);
            let layout = environments::environment_layout(lowering.file, scope);
            lowering
                .builder
                .get_environment_field(environment, layout, field)
        }
        Storage::Variable(key) => {
            let variable = variables::ensure_variable(lowering.file, key);
            lowering.builder.get_module_variable(variable)
        }
        Storage::Local => {
            unreachable!("the scope of a local is entered before code that names it")
        }
    }
}

pub(super) fn set_stored(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: BindingRef,
    value: ValueId,
) {
    let Some(placement) = lowering.file.scopes.placement(binding) else {
        return;
    };
    let local = lowering.scopes.find_local(binding);
    if let Some(local) = local {
        lowering.builder.write_variable(local.variable, value);
    }
    match placement.storage {
        Storage::Field { scope, field } => {
            let environment = environments::get_environment(lowering, scope);
            let layout = environments::environment_layout(lowering.file, scope);
            lowering
                .builder
                .put_environment_field(environment, layout, field, value);
        }
        Storage::Variable(key) => {
            let variable = variables::ensure_variable(lowering.file, key);
            lowering.builder.put_module_variable(variable, value);
        }
        Storage::Local => debug_assert!(
            local.is_some(),
            "the scope of a local is entered before code that stores to it"
        ),
    }
}

pub(crate) fn get_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
) -> ValueId {
    match normalize_binding(lowering.file, binding) {
        Binding::Symbol(symbol) => get_symbol(lowering, symbol, name),
        Binding::Arguments(unit) => {
            let slot = code_unit_slot(lowering.file, unit, ScopeSlot::ArgumentsBinding);
            get_stored(lowering, slot)
        }
        Binding::CommonJs(variable) => commonjs::get_commonjs_variable(lowering, variable),
        Binding::Free => identifiers::get_free_name(lowering, name, false),
    }
}

pub(super) fn set_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
    source: Option<ExprId>,
) {
    store_binding(lowering, binding, name, value, source, true);
}

pub(super) fn store_checked_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
    source: Option<ExprId>,
) {
    store_binding(lowering, binding, name, value, source, false);
}

pub(super) fn initialize_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
    source: Option<ExprId>,
) {
    match binding {
        Binding::Symbol(symbol) => {
            let position = positions::binding_position(lowering.file, symbol);
            let subject = convert::Int32Subject::Binding(symbol);
            convert::describe_int32_flow(lowering, position, subject, source);
            let value = convert::convert_initializer(lowering, value, position, source);
            write_symbol(lowering, symbol, name, value, BindingStore::Initialize);
        }
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
            set_binding(lowering, binding, name, value, source);
        }
    }
}

pub(crate) fn initialize_converted_symbol(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
    value: ValueId,
) {
    write_symbol(lowering, symbol, name, value, BindingStore::Initialize);
}

pub(super) fn get_arguments_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    unit: CodeUnit,
) -> ValueId {
    let slot = code_unit_slot(lowering.file, unit, ScopeSlot::Arguments);
    get_stored(lowering, slot)
}

pub(in crate::lower) fn get_mapped_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    unit: CodeUnit,
    index: u32,
) -> ValueId {
    let arguments = get_arguments_object(lowering, unit);
    lowering.builder.get_mapped_argument(arguments, index)
}

pub(in crate::lower) fn set_mapped_argument(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    unit: CodeUnit,
    index: u32,
    value: ValueId,
) {
    let arguments = get_arguments_object(lowering, unit);
    lowering
        .builder
        .set_mapped_argument(arguments, index, value);
}

pub(super) fn get_container_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    container: SymbolId,
) -> ValueId {
    let bound = lowering.file.bound;
    let binding = find_container_binding(bound, lowering.scopes.innermost_scope(), container);
    get_symbol(lowering, binding, bound.symbol(binding).name)
}

pub(super) fn emit_binding_error(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    error: RuntimeErrorKind,
    name: Atom,
) {
    let name = lowering.file.intern_atom(name);
    exception::emit_throw_runtime_error(lowering, error, Some(name));
}

fn store_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    binding: Binding,
    name: Atom,
    value: ValueId,
    source: Option<ExprId>,
    tests_dead_zone: bool,
) {
    match normalize_binding(lowering.file, binding) {
        Binding::Symbol(symbol) => {
            store_symbol(lowering, symbol, name, value, source, tests_dead_zone);
        }
        Binding::Arguments(unit) => {
            let slot = code_unit_slot(lowering.file, unit, ScopeSlot::ArgumentsBinding);
            set_stored(lowering, slot, value);
        }
        Binding::CommonJs(variable) => commonjs::set_commonjs_variable(lowering, variable, value),
        Binding::Free => identifiers::set_free_name(lowering, name, value),
    }
}

fn get_symbol(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
) -> ValueId {
    match lowering.file.scopes.form(symbol) {
        BindingForm::NotAValue => {
            emit_binding_error(lowering, RuntimeErrorKind::UnresolvableReference, name);
            lowering.builder.undefined()
        }
        BindingForm::Import => module::get_import(lowering, symbol),
        BindingForm::Callee { function } => get_callee_binding(lowering, function),
        BindingForm::MappedArgument { unit, index } => get_mapped_argument(lowering, unit, index),
        BindingForm::ContainerMember { container } => {
            let object = get_container_object(lowering, container);
            let key = member::name_key(lowering.file, name);
            member::emit_get(lowering, object, PropertyName::Constant(key))
        }
        BindingForm::Stored => dead_zone::get_checked(lowering, symbol, name),
    }
}

fn store_symbol(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
    value: ValueId,
    source: Option<ExprId>,
    tests_dead_zone: bool,
) {
    match lowering.file.bound.binding_kind(symbol) {
        BindingKind::Const | BindingKind::ClassInnerName => {
            if tests_dead_zone {
                get_symbol(lowering, symbol, name);
            }
            emit_binding_error(lowering, RuntimeErrorKind::ConstantAssignment, name);
            return;
        }
        BindingKind::FunctionName => {
            if lowering.mode() == ECMAMode::Strict {
                emit_binding_error(lowering, RuntimeErrorKind::ConstantAssignment, name);
            }
            return;
        }
        BindingKind::Import => {
            emit_binding_error(lowering, RuntimeErrorKind::ImportAssignment, name);
            return;
        }
        BindingKind::NoBinding
        | BindingKind::TypeScriptContainer
        | BindingKind::Var
        | BindingKind::Let
        | BindingKind::SimpleCatchParameter
        | BindingKind::Class
        | BindingKind::Function
        | BindingKind::Parameter => {}
    }
    let position = positions::binding_position(lowering.file, symbol);
    let subject = convert::Int32Subject::Binding(symbol);
    convert::describe_int32_flow(lowering, position, subject, source);
    let value = convert::convert(lowering, value, position, source);
    if tests_dead_zone && lowering.file.scopes.form(symbol) == BindingForm::Stored {
        dead_zone::check_before_store(lowering, symbol, name);
    }
    write_symbol(lowering, symbol, name, value, BindingStore::Assign);
}

fn write_symbol(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    symbol: SymbolId,
    name: Atom,
    value: ValueId,
    store: BindingStore,
) {
    match lowering.file.scopes.form(symbol) {
        BindingForm::Stored => {
            let binding = BindingRef::Symbol(symbol);
            set_stored(lowering, binding, value);
            match store {
                BindingStore::Initialize => lowering.scopes.end_dead_zone(binding),
                BindingStore::Assign => {}
            }
        }
        BindingForm::MappedArgument { unit, index } => {
            set_mapped_argument(lowering, unit, index, value);
        }
        BindingForm::ContainerMember { container } => {
            let object = get_container_object(lowering, container);
            let key = member::name_key(lowering.file, name);
            member::emit_set(lowering, object, PropertyName::Constant(key), value);
        }
        BindingForm::NotAValue => match store {
            BindingStore::Initialize => {
                debug_assert!(false, "a symbol without a value is never initialized");
            }
            BindingStore::Assign => {
                emit_binding_error(lowering, RuntimeErrorKind::UnresolvableReference, name);
            }
        },
        BindingForm::Callee { .. } | BindingForm::Import => {
            debug_assert!(false, "a callee or an import is never stored");
        }
    }
}

fn get_callee_binding(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    function: FnId,
) -> ValueId {
    let bound = lowering.file.bound;
    let top = bound.fns[function.idx()].scope;
    let mut scope = lowering.scopes.innermost_scope();
    while scope.is_some() {
        if scope == top {
            return get_stored(lowering, BindingRef::Slot(top, ScopeSlot::Callee));
        }
        scope = bound.scopes[scope.idx()].parent;
    }
    let declared = function::declare_source_function(lowering.file, function, None);
    function::emit_closure(lowering, declared, None)
}
