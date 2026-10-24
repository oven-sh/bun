use bun_sema::bind::{CodeUnit, CommonJsVariable, ScopeId};
use bun_sema::hir::{FnBody, FnId};
use smallvec::SmallVec;

use super::exports;
use super::variables::{BodyForm, WRAPPER_PARAMETERS};
use crate::ir::generated::{Function, FunctionFlags, FunctionKind};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, ValueId};
use crate::lower::function::{self, EntryArguments};
use crate::lower::scope::{BindingForm, BindingRef, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering, convert, module, object};
use crate::modules::{ModuleRef, Shape};

type EntryValues = SmallVec<[(BindingRef, ValueId); 6]>;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn lower_commonjs_body(&mut self, function: FunctionId) {
        match self.body_form() {
            BodyForm::Plain => self.lower_plain_body(function),
            BodyForm::Wrapped => self.lower_calling_body(function),
            BodyForm::NotCommonJs => unreachable!("the self is a CommonJS module"),
        }
    }

    fn has_exports_variable(&self, module: ModuleRef) -> bool {
        match self.inputs.modules.shape(module) {
            Shape::Value | Shape::AsToday => true,
            Shape::EsModule | Shape::Names => false,
        }
    }

    fn lower_plain_body(&mut self, function: FunctionId) {
        let scope = module::file_scope(self);
        let own_module = ModuleRef::File(self.file);
        let mut lowering = FunctionLowering::begin(self, function);
        let first_exports = lowering.emit_first_exports(own_module);
        lowering.enter_plain_file_scope(scope, first_exports);
        lowering.lower_file_statements();
        finish_body(lowering, Some(scope));
    }

    fn declare_wrapped_body(&mut self) -> FunctionId {
        let key = FunctionKey::WrappedModuleBody(self.file);
        self.declare_function(key, create_wrapped_header)
    }

    // A file that stores to one of the five names, or shows them to code that finds names at run time, has them as the parameters they are to `bun run`.
    fn lower_calling_body(&mut self, function: FunctionId) {
        let wrapped = self.declare_wrapped_body();
        let own_module = ModuleRef::File(self.file);
        let mut lowering = FunctionLowering::begin(self, function);
        let first_exports = match lowering.emit_first_exports(own_module) {
            Some(first_exports) => first_exports,
            None => lowering.builder.undefined(),
        };
        let mut values: SmallVec<[ValueId; 5]> = SmallVec::new();
        for variable in WRAPPER_PARAMETERS {
            values.push(match variable {
                CommonJsVariable::Exports => first_exports,
                _ => lowering.emit_passed_value(variable),
            });
        }
        let arguments = EntryArguments {
            this: Some(first_exports),
            new_target: None,
            parameters: &values,
        };
        lowering.emit_direct_call(wrapped, arguments);
        finish_body(lowering, None);
    }

    pub(in crate::lower) fn lower_wrapped_body(&mut self, function: FunctionId) {
        let scope = module::file_scope(self);
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.enter_wrapped_file_scope(scope);
        lowering.lower_file_statements();
        finish_body(lowering, Some(scope));
    }

    fn find_inner_module(&self, callback: FnId) -> ModuleRef {
        let module = self.inputs.modules.inner_module(self.file, callback);
        module.expect("the function is the callback of an inner module")
    }

    // The callback of `__commonJS(cb)` or `__esm(fn)` is the body of a module: nobody passes it anything, and nobody gets what it returns.
    pub(in crate::lower) fn declare_inner_module_body(&mut self, callback: FnId) -> FunctionId {
        function::declare_source_function_with(self, callback, &mut |_, header| {
            header.kind = FunctionKind::CommonJsModule;
            header.flags = header.flags.without(FunctionFlags::HAS_THIS);
            header.this_type = DeclaredType::untyped();
            header.length = 0;
            header.parameters = Vec::new();
            header.results = vec![DeclaredType::untyped()];
        })
    }

    pub(in crate::lower) fn lower_inner_module_body(
        &mut self,
        function: FunctionId,
        callback: FnId,
    ) {
        let module = self.find_inner_module(callback);
        let scope = self.bound.fns[callback.idx()].scope;
        let [exports_name, module_name] = self.inner_parameters(callback);
        let mut lowering = FunctionLowering::begin(self, function);
        let first_exports = lowering.emit_first_exports(module);
        let mut entry_values = EntryValues::new();
        for (symbol, is_exports) in [(exports_name, true), (module_name, false)] {
            let Some(symbol) = symbol else {
                continue;
            };
            if lowering.file.scopes.form(symbol) != BindingForm::Stored {
                continue;
            }
            let value = match (is_exports, first_exports) {
                (true, Some(first_exports)) => first_exports,
                // Only whether it is an object can be asked of it.
                (true, None) => lowering.builder.boolean(true),
                (false, _) => lowering.builder.undefined(),
            };
            entry_values.push((BindingRef::Symbol(symbol), value));
        }
        entry_values.sort_by_key(|entry| entry.0);
        entry_values.dedup_by_key(|entry| entry.0);
        lowering.allocate_scope(scope, &entry_values);
        lowering.instantiate_functions(scope);
        match lowering.file.hir[callback].body {
            FnBody::Block(statements) => lowering.lower_statements(statements),
            FnBody::Expr(value) => lowering.lower_expression_for_effect(value),
            FnBody::None => {}
        }
        finish_body(lowering, Some(scope));
    }
}

fn finish_body(mut lowering: FunctionLowering<'_, '_, '_, '_, '_>, scope: Option<ScopeId>) {
    if let Some(scope) = scope {
        lowering.leave_scope(scope);
    }
    let undefined = lowering.builder.undefined();
    lowering.emit_return(undefined, None);
    lowering.finish();
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // The body begins as if it were written `exports = module.exports = {}`, with the layout of the names it stores.
    fn emit_first_exports(&mut self, module: ModuleRef) -> Option<ValueId> {
        if !self.file.has_exports_variable(module) {
            return None;
        }
        let variable = exports::ensure_exports_variable(self.file, module)?;
        let layout = match module {
            ModuleRef::File(file) => {
                let is_seen = self.file.body_form() == BodyForm::Wrapped
                    || self.file.begins_with_exports_object(file);
                if !is_seen {
                    return None;
                }
                self.file.module_exports_layout(file)
            }
            _ => None,
        };
        let layout = layout.unwrap_or_else(|| self.file.untyped_layout(&[]));
        let builder = self.begin_object(layout);
        let created = object::finish_object(self, builder);
        self.builder.put_module_variable(variable, created);
        Some(created)
    }

    pub(in crate::lower) fn set_own_exports(&mut self, value: ValueId) {
        let own_module = ModuleRef::File(self.file.file);
        if !self.file.has_exports_variable(own_module) {
            return;
        }
        if let Some(variable) = exports::ensure_exports_variable(self.file, own_module) {
            self.builder.put_module_variable(variable, value);
        }
    }

    // `this` at the top is the object that the body begins with. None of the five names is read from the scope.
    fn enter_plain_file_scope(&mut self, scope: ScopeId, first_exports: Option<ValueId>) {
        let mut entry_values = EntryValues::new();
        let slots = WRAPPER_PARAMETERS.into_iter().map(ScopeSlot::CommonJs);
        for slot in [ScopeSlot::This].into_iter().chain(slots) {
            let binding = BindingRef::Slot(scope, slot);
            if self.file.scopes.placement(binding).is_none() {
                continue;
            }
            let value = match (slot, first_exports) {
                (ScopeSlot::This, Some(first_exports)) => first_exports,
                _ => self.builder.undefined(),
            };
            entry_values.push((binding, value));
        }
        if let Some(first_exports) = first_exports {
            self.store_first_exports(first_exports);
        }
        self.allocate_scope(scope, &entry_values);
        self.instantiate_functions(scope);
    }

    fn enter_wrapped_file_scope(&mut self, scope: ScopeId) {
        let mut entry_values = EntryValues::new();
        self.collect_arguments_object(scope, &mut entry_values);
        self.collect_wrapper_parameters(scope, &mut entry_values);
        self.collect_redeclared_variables(&mut entry_values);
        self.allocate_scope(scope, &entry_values);
        self.instantiate_functions(scope);
    }

    fn collect_arguments_object(&mut self, scope: ScopeId, entry_values: &mut EntryValues) {
        let indexes = 0..WRAPPER_PARAMETERS.len() as u32;
        let values: SmallVec<[ValueId; 5]> =
            indexes.map(|index| self.builder.parameter(index)).collect();
        let object = self.create_arguments_object(CodeUnit::File, &values);
        if let Some(object) = object {
            entry_values.push((BindingRef::Slot(scope, ScopeSlot::Arguments), object));
        }
    }

    fn collect_wrapper_parameters(&mut self, scope: ScopeId, entry_values: &mut EntryValues) {
        for variable in WRAPPER_PARAMETERS {
            let binding = BindingRef::Slot(scope, ScopeSlot::CommonJs(variable));
            if self.file.scopes.placement(binding).is_none() {
                continue;
            }
            let value = self.emit_commonjs_entry_value(variable);
            entry_values.push((binding, value));
        }
    }

    fn collect_redeclared_variables(&mut self, entry_values: &mut EntryValues) {
        let bound = self.file.bound;
        for &(symbol, variable) in bound.runtime.redeclared_commonjs_variables() {
            let binding = BindingRef::Symbol(symbol);
            if self.file.scopes.placement(binding).is_none() {
                continue;
            }
            let value = self.emit_commonjs_entry_value(variable);
            let position = self.file.binding_position(symbol);
            let value = convert::convert(self, value, position, None);
            entry_values.push((binding, value));
        }
    }
}

fn create_wrapped_header(file: &mut FileLowering<'_, '_, '_, '_>) -> Function {
    let key = FunctionKey::WrappedModuleBody(file.file);
    let mut header = function::create_header(file, key, FunctionKind::Plain, 0);
    header.flags |= file.scopes.entry_flags(FunctionKey::ModuleBody(file.file));
    header.flags |= FunctionFlags::HAS_THIS;
    if !file.hir.is_strict {
        header.flags |= FunctionFlags::IS_SLOPPY;
    }
    header.length = WRAPPER_PARAMETERS.len() as u32;
    header.parameters = vec![DeclaredType::untyped(); WRAPPER_PARAMETERS.len()];
    header
}
