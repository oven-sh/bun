use bun_sema::bind::{CodeUnit, CommonJsVariable, ScopeId};
use bun_sema::hir::{FnBody, FnId};
use smallvec::SmallVec;

use super::variables::{BodyForm, WRAPPER_PARAMETERS, emit_entry_value};
use crate::ir::generated::{Function, FunctionFlags, FunctionKind};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, ValueId};
use crate::lower::function::{self, EntryArguments};
use crate::lower::scope::{BindingForm, BindingRef, ScopeSlot};
use crate::lower::{FileLowering, FunctionLowering, convert, module, object};
use crate::modules::ModuleRef;

type EntryValues = SmallVec<[(BindingRef, ValueId); 6]>;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn lower_commonjs_body(&mut self, function: FunctionId) {
        match self.body_form() {
            BodyForm::Plain => self.lower_plain_body(function),
            BodyForm::Wrapped => self.lower_calling_body(function),
            BodyForm::NotCommonJs => unreachable!("the self is a CommonJS module"),
        }
    }

    fn lower_plain_body(&mut self, function: FunctionId) {
        let scope = module::file_scope(self);
        let own_module = ModuleRef::File(self.file);
        let mut lowering = FunctionLowering::begin(self, function);
        let first_exports = lowering.emit_first_exports(own_module);
        lowering.enter_plain_file_scope(scope, first_exports);
        lowering.lower_file_statements();
        module::finish_body(lowering, Some(scope));
    }

    // A file that stores to one of the five names, or shows them to code that finds names at run time, has them as the parameters they are to `bun run`.
    fn lower_calling_body(&mut self, function: FunctionId) {
        let key = FunctionKey::WrappedModuleBody(self.file);
        let wrapped = self.declare_function(key, create_wrapped_header);
        let own_module = ModuleRef::File(self.file);
        let mut lowering = FunctionLowering::begin(self, function);
        let first_exports = lowering.emit_first_exports(own_module);
        let first_exports = first_exports.unwrap_or_else(|| lowering.builder.undefined());
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
        module::finish_body(lowering, None);
    }

    pub(in crate::lower) fn lower_wrapped_body(&mut self, function: FunctionId) {
        let scope = module::file_scope(self);
        let mut lowering = FunctionLowering::begin(self, function);
        lowering.enter_wrapped_file_scope(scope);
        lowering.lower_file_statements();
        module::finish_body(lowering, Some(scope));
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
        let module = self.inputs.modules.inner_module(self.file, callback);
        let module = module.expect("the function is the callback of an inner module");
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
        module::finish_body(lowering, Some(scope));
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    // The body begins as if it were written `exports = module.exports = {}`, with the layout of the names it stores.
    fn emit_first_exports(&mut self, module: ModuleRef) -> Option<ValueId> {
        let variable = self.file.ensure_whole_exports_variable(module)?;
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
        if let Some(variable) = self.file.ensure_whole_exports_variable(own_module) {
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
        let indexes = 0..WRAPPER_PARAMETERS.len() as u32;
        let values: SmallVec<[ValueId; 5]> =
            indexes.map(|index| self.builder.parameter(index)).collect();
        let object = self.create_arguments_object(CodeUnit::File, &values);
        if let Some(object) = object {
            entry_values.push((BindingRef::Slot(scope, ScopeSlot::Arguments), object));
        }
        for variable in WRAPPER_PARAMETERS {
            let binding = BindingRef::Slot(scope, ScopeSlot::CommonJs(variable));
            if self.file.scopes.placement(binding).is_none() {
                continue;
            }
            let value = emit_entry_value(self, variable);
            entry_values.push((binding, value));
        }
        let bound = self.file.bound;
        for &(symbol, variable) in bound.runtime.redeclared_commonjs_variables() {
            let binding = BindingRef::Symbol(symbol);
            if self.file.scopes.placement(binding).is_none() {
                continue;
            }
            let value = emit_entry_value(self, variable);
            let position = self.file.binding_position(symbol);
            let value = convert::convert(self, value, position, None);
            entry_values.push((binding, value));
        }
        self.allocate_scope(scope, &entry_values);
        self.instantiate_functions(scope);
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
