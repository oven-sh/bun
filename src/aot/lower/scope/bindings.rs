use bun_sema::atom::Atom;
use bun_sema::bind::{Binding, BindingKind, CodeUnit, ScopeId, SymbolId};
use bun_sema::hir::{ExprId, FnId, StmtId};
use smallvec::SmallVec;

use super::lexical_owners::find_container_binding;
use super::{BindingForm, BindingRef, DeadZone, ScopeSlot, Storage, environments};
use crate::ir::generated::{ECMAMode, RuntimeErrorKind};
use crate::ir::{LocalVariable, ValueId};
use crate::lower::captures::Capture;
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, convert, function};

#[derive(Copy, Clone, PartialEq, Eq)]
enum BindingStore {
    Initialize,
    Assign,
    Release,
}

impl FileLowering<'_, '_, '_, '_> {
    pub(super) fn code_unit_slot(&self, unit: CodeUnit, slot: ScopeSlot) -> BindingRef {
        BindingRef::Slot(self.bound.top_scope(self.hir, unit), slot)
    }
}

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
        self.make_environment_put_off(scope);
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

    pub(in crate::lower) fn read_what_was_stored_under_handlers(&mut self, statement: StmtId) {
        let bindings = self.file.scopes.stored_under_handlers(statement);
        let bindings: SmallVec<[BindingRef; 8]> = SmallVec::from_slice(bindings);
        let mut read: SmallVec<[(LocalVariable, ValueId); 8]> = SmallVec::new();
        for binding in bindings {
            let placement = self.file.scopes.placement(binding);
            let (Some(local), Some(placement)) = (self.scopes.find_local(binding), placement)
            else {
                continue;
            };
            let (Storage::Field { scope, field }, BindingRef::Symbol(symbol)) =
                (placement.storage, binding)
            else {
                continue;
            };
            if local.dead_zone == DeadZone::Uninitialized {
                continue;
            }
            let environment = self.get_environment(scope);
            let layout = environments::environment_layout(self.file, scope);
            let value = self
                .builder
                .get_environment_field(environment, layout, field);
            let value = match local.dead_zone {
                DeadZone::Initialized => {
                    let name = self.file.bound.symbol(symbol).name;
                    self.emit_initialization_check(value, symbol, name)
                }
                DeadZone::Never | DeadZone::Uninitialized | DeadZone::DecidedAtRunTime => value,
            };
            read.push((local.variable, value));
        }
        for (variable, value) in read {
            self.builder.write_variable(variable, value);
        }
    }

    pub(super) fn set_stored(&mut self, binding: BindingRef, value: ValueId) {
        self.set_stored_as(binding, value, BindingStore::Initialize);
    }

    fn set_stored_as(&mut self, binding: BindingRef, value: ValueId, store: BindingStore) {
        let Some(placement) = self.file.scopes.placement(binding) else {
            return;
        };
        let local = self.scopes.find_local(binding);
        if let Some(local) = local {
            match (store, &placement.storage) {
                (BindingStore::Release, Storage::Local) => {
                    self.builder.write_released_variable(local.variable, value);
                }
                (_, Storage::Field { .. }) => {
                    self.builder
                        .write_variable_kept_in_field(local.variable, value);
                }
                _ => self.builder.write_variable(local.variable, value),
            }
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

    pub(crate) fn get_binding_without_expression(
        &mut self,
        binding: Binding,
        name: Atom,
    ) -> ValueId {
        debug_assert!(
            !matches!(binding, Binding::Symbol(symbol) if self.file.inputs.modules.holder(self.file.file, symbol).is_some()),
            "a name that only stands for a module is read for its object"
        );
        self.get_binding(binding, name)
    }

    pub(crate) fn initialize_converted_symbol(
        &mut self,
        symbol: SymbolId,
        name: Atom,
        value: ValueId,
    ) {
        self.write_symbol(symbol, name, value, BindingStore::Initialize, None);
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
        self.store_binding_in(None, binding, name, value, source, tests_dead_zone);
    }

    pub(super) fn store_member_of(
        &mut self,
        container: ValueId,
        binding: Binding,
        name: Atom,
        value: ValueId,
        source: Option<ExprId>,
    ) {
        self.store_binding_in(Some(container), binding, name, value, source, false);
    }

    fn store_binding_in(
        &mut self,
        container: Option<ValueId>,
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
        let store = match self.builder.is_undefined_or_null(value) {
            true => BindingStore::Release,
            false => BindingStore::Assign,
        };
        self.describe_int32_flow_into_binding(position, symbol, source);
        let value = convert::convert(self, value, position, source);
        if tests_dead_zone && self.file.scopes.form(symbol) == BindingForm::Stored {
            self.check_before_store(symbol, name);
        }
        self.write_symbol(symbol, name, value, store, container);
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
            BindingForm::Stored => match self.file.scopes.function_made_at_first_read(symbol) {
                Some(function) => self.get_function_made_at_first_read(symbol, name, function),
                None => self.get_checked(symbol, name),
            },
        }
    }

    fn get_function_made_at_first_read(
        &mut self,
        symbol: SymbolId,
        name: Atom,
        function: FnId,
    ) -> ValueId {
        if self.file.scopes.is_created_at_each_read(symbol) {
            let id = function::declare_source_function(self.file, function, None);
            return self.emit_closure(id, None);
        }
        let held = self.get_checked(symbol, name);
        if self.builder.is_new_closure(held)
            || self.scopes.created_functions.get(&symbol) == Some(&held)
        {
            return held;
        }
        let create = |lowering: &mut Self| {
            let id = function::declare_source_function(lowering.file, function, None);
            let closure = lowering.emit_closure(id, None);
            lowering.write_symbol(symbol, name, closure, BindingStore::Assign, None);
            closure
        };
        if self.builder.is_undefined_or_null(held) {
            return create(self);
        }
        let closure = self.lower_unless_nullish(held, create);
        if let Some(local) = self.scopes.find_local(BindingRef::Symbol(symbol)) {
            self.builder.write_variable(local.variable, closure);
            self.scopes.created_functions.insert(symbol, closure);
        }
        closure
    }

    fn write_symbol(
        &mut self,
        symbol: SymbolId,
        name: Atom,
        value: ValueId,
        store: BindingStore,
        container_in_hand: Option<ValueId>,
    ) {
        match self.file.scopes.form(symbol) {
            BindingForm::Stored => {
                let binding = BindingRef::Symbol(symbol);
                self.set_stored_as(binding, value, store);
                match store {
                    BindingStore::Initialize => self.scopes.end_dead_zone(binding),
                    BindingStore::Assign | BindingStore::Release => {}
                }
            }
            BindingForm::MappedArgument { unit, index } => {
                self.set_mapped_argument(unit, index, value);
            }
            BindingForm::ContainerMember { container } => {
                let object = match container_in_hand {
                    Some(object) => object,
                    None => self.get_container_object(container),
                };
                let key = self.file.name_key(name);
                self.emit_set(object, PropertyName::Constant(key), value);
            }
            BindingForm::NotAValue => match store {
                BindingStore::Initialize => {
                    debug_assert!(false, "a symbol without a value is never initialized");
                }
                BindingStore::Assign | BindingStore::Release => {
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
            if source.is_none() {
                lowering.describe_int32_flow_into_binding(position, symbol, None);
            }
            let value = lowering.convert_initializer(value, position, source);
            lowering.write_symbol(symbol, name, value, BindingStore::Initialize, None);
        }
        Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => {
            lowering.store_binding(binding, name, value, source, true);
        }
    }
}
