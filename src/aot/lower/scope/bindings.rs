use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingKind, CodeUnit, ScopeId, SymbolId};
use bun_sema::hir::{ExprId, FnId};

use super::lexical_owners::find_container_binding;
use super::{BindingForm, BindingRef, ScopeSlot, Storage, environments};
use crate::ir::ValueId;
use crate::ir::generated::{ECMAMode, RuntimeErrorKind};
use crate::lower::captures::Capture;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, convert, function};

#[derive(Copy, Clone, PartialEq, Eq)]
enum BindingStore {
    Initialize,
    Assign,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn code_unit_slot(&self, unit: CodeUnit, slot: ScopeSlot) -> BindingRef {
        BindingRef::Slot(self.bound.top_scope(self.hir, unit), slot)
    }
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(in crate::lower) fn get_environment(&mut self, scope: ScopeId) -> ValueId {
        match self.scopes.find_environment(scope) {
            Some(variable) => self.builder.read_variable(variable),
            None => self
                .find_captured_value(Capture::Environment(scope))
                .expect("a function captures every environment it reaches"),
        }
    }

    pub(in crate::lower) fn get_stored(&mut self, binding: BindingRef) -> ValueId {
        if let Some(local) = self.scopes.find_local(binding) {
            return self.builder.read_variable(local.variable);
        }
        if let Some(value) = self.find_captured_value(Capture::Value(binding)) {
            return value;
        }
        let placement = self.file.scopes.placement(binding);
        let placement = placement.expect("the scope walk records every binding that is read");
        match placement.storage {
            Storage::Field { scope, field } => {
                let environment = self.get_environment(scope);
                let layout = environments::environment_layout(self.file, scope);
                self.builder
                    .get_environment_field(environment, layout, field)
            }
            Storage::Variable(key) => {
                let variable = self.file.ensure_variable(key);
                self.builder.get_module_variable(variable)
            }
            Storage::Local => {
                unreachable!("the scope of a local is entered before code that names it")
            }
        }
    }

    pub(super) fn set_stored(&mut self, binding: BindingRef, value: ValueId) {
        let Some(placement) = self.file.scopes.placement(binding) else {
            return;
        };
        let local = self.scopes.find_local(binding);
        if let Some(local) = local {
            self.builder.write_variable(local.variable, value);
        }
        match placement.storage {
            Storage::Field { scope, field } => {
                let environment = self.get_environment(scope);
                let layout = environments::environment_layout(self.file, scope);
                self.builder
                    .put_environment_field(environment, layout, field, value);
            }
            Storage::Variable(key) => {
                let variable = self.file.ensure_variable(key);
                self.builder.put_module_variable(variable, value);
            }
            Storage::Local => debug_assert!(
                local.is_some(),
                "the scope of a local is entered before code that stores to it"
            ),
        }
    }

    pub(crate) fn get_binding(&mut self, binding: Binding, name: Atom) -> ValueId {
        match normalize_binding(self.file, binding) {
            Binding::Symbol(symbol) => self.get_symbol(symbol, name),
            Binding::Arguments(unit) => {
                self.get_stored(self.file.code_unit_slot(unit, ScopeSlot::ArgumentsBinding))
            }
            Binding::CommonJs(variable) => self.get_commonjs_variable(variable),
            Binding::Free => self.emit_free_name_get(name, false),
        }
    }

    pub(crate) fn initialize_converted_symbol(
        &mut self,
        symbol: SymbolId,
        name: Atom,
        value: ValueId,
    ) {
        self.write_symbol(symbol, name, value, BindingStore::Initialize);
    }

    pub(super) fn get_arguments_object(&mut self, unit: CodeUnit) -> ValueId {
        self.get_stored(self.file.code_unit_slot(unit, ScopeSlot::Arguments))
    }

    pub(in crate::lower) fn get_mapped_argument(&mut self, unit: CodeUnit, index: u32) -> ValueId {
        let arguments = self.get_arguments_object(unit);
        self.builder.get_mapped_argument(arguments, index)
    }

    pub(in crate::lower) fn set_mapped_argument(
        &mut self,
        unit: CodeUnit,
        index: u32,
        value: ValueId,
    ) {
        let arguments = self.get_arguments_object(unit);
        self.builder.set_mapped_argument(arguments, index, value);
    }

    pub(super) fn get_container_object(&mut self, container: SymbolId) -> ValueId {
        let bound = self.file.bound;
        let binding = find_container_binding(bound, self.scopes.innermost_scope(), container);
        self.get_symbol(binding, bound.symbol(binding).name)
    }

    pub(super) fn emit_binding_error(
        &mut self,
        error: RuntimeErrorKind,
        binding: Binding,
        name: Atom,
    ) {
        let name = self.file.intern_binding_name(binding, name);
        self.emit_throw_runtime_error(error, Some(name));
    }

    pub(super) fn store_binding(
        &mut self,
        binding: Binding,
        name: Atom,
        value: ValueId,
        source: Option<ExprId>,
        tests_dead_zone: bool,
    ) {
        let symbol = match normalize_binding(self.file, binding) {
            Binding::Symbol(symbol) => symbol,
            Binding::Arguments(unit) => {
                let slot = self.file.code_unit_slot(unit, ScopeSlot::ArgumentsBinding);
                return self.set_stored(slot, value);
            }
            Binding::CommonJs(variable) => return self.set_commonjs_variable(variable, value),
            Binding::Free => return self.emit_free_name_set(name, value),
        };
        let error = match self.file.bound.binding_kind(symbol) {
            BindingKind::Const | BindingKind::ClassInnerName => {
                if tests_dead_zone {
                    self.get_symbol(symbol, name);
                }
                Some(RuntimeErrorKind::ConstantAssignment)
            }
            BindingKind::FunctionName if self.mode() == ECMAMode::Strict => {
                Some(RuntimeErrorKind::ConstantAssignment)
            }
            BindingKind::FunctionName => return,
            BindingKind::Import => Some(RuntimeErrorKind::ImportAssignment),
            BindingKind::NoBinding
            | BindingKind::TypeScriptContainer
            | BindingKind::Var
            | BindingKind::Let
            | BindingKind::SimpleCatchParameter
            | BindingKind::Class
            | BindingKind::Function
            | BindingKind::Parameter => None,
        };
        if let Some(error) = error {
            return self.emit_binding_error(error, Binding::Symbol(symbol), name);
        }
        let position = self.file.binding_position(symbol);
        let subject = convert::Int32Subject::Binding(symbol);
        self.describe_int32_flow(position, subject, source);
        let value = convert::convert(self, value, position, source);
        if tests_dead_zone && self.file.scopes.form(symbol) == BindingForm::Stored {
            self.check_before_store(symbol, name);
        }
        self.write_symbol(symbol, name, value, BindingStore::Assign);
    }

    fn get_symbol(&mut self, symbol: SymbolId, name: Atom) -> ValueId {
        match self.file.scopes.form(symbol) {
            BindingForm::NotAValue => {
                let error = RuntimeErrorKind::UnresolvableReference;
                self.emit_binding_error(error, Binding::Free, name);
                self.builder.undefined()
            }
            BindingForm::Import => self.get_import(symbol),
            BindingForm::Callee { function } => self.get_callee_binding(function),
            BindingForm::MappedArgument { unit, index } => self.get_mapped_argument(unit, index),
            BindingForm::ContainerMember { container } => {
                let object = self.get_container_object(container);
                let key = self.file.name_key(name);
                self.emit_get(object, PropertyName::Constant(key))
            }
            BindingForm::Stored => self.get_checked(symbol, name),
        }
    }

    fn write_symbol(&mut self, symbol: SymbolId, name: Atom, value: ValueId, store: BindingStore) {
        match self.file.scopes.form(symbol) {
            BindingForm::Stored => {
                let binding = BindingRef::Symbol(symbol);
                self.set_stored(binding, value);
                match store {
                    BindingStore::Initialize => self.scopes.end_dead_zone(binding),
                    BindingStore::Assign => {}
                }
            }
            BindingForm::MappedArgument { unit, index } => {
                self.set_mapped_argument(unit, index, value);
            }
            BindingForm::ContainerMember { container } => {
                let object = self.get_container_object(container);
                let key = self.file.name_key(name);
                self.emit_set(object, PropertyName::Constant(key), value);
            }
            BindingForm::NotAValue => match store {
                BindingStore::Initialize => {
                    debug_assert!(false, "a symbol without a value is never initialized");
                }
                BindingStore::Assign => {
                    let error = RuntimeErrorKind::UnresolvableReference;
                    self.emit_binding_error(error, Binding::Free, name);
                }
            },
            BindingForm::Callee { .. } | BindingForm::Import => {
                debug_assert!(false, "a callee or an import is never stored");
            }
        }
    }

    fn get_callee_binding(&mut self, function: FnId) -> ValueId {
        let bound = self.file.bound;
        let top = bound.fns[function.idx()].scope;
        let mut scope = self.scopes.innermost_scope();
        while scope.is_some() {
            if scope == top {
                return self.get_stored(BindingRef::Slot(top, ScopeSlot::Callee));
            }
            scope = bound.scopes[scope.idx()].parent;
        }
        let declared = function::declare_source_function(self.file, function, None);
        self.emit_closure(declared, None)
    }
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
            let position = lowering.file.binding_position(symbol);
            let subject = convert::Int32Subject::Binding(symbol);
            lowering.describe_int32_flow(position, subject, source);
            let value = lowering.convert_initializer(value, position, source);
            lowering.write_symbol(symbol, name, value, BindingStore::Initialize);
        }
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
            lowering.store_binding(binding, name, value, source, true);
        }
    }
}
