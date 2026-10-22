use bun_sema::bind::{CodeUnit, CommonJsVariable, ScopeId};
use bun_sema::hir::{FnBody, FnId};
use smallvec::SmallVec;

use super::variables::{self, BodyForm, WRAPPER_PARAMETERS};
use super::{emit_commonjs_entry_value, exports};
use crate::ir::generated::{Function, FunctionFlags, FunctionKind};
use crate::ir::{DeclaredType, FunctionId, FunctionKey, ValueId};
use crate::lower::function::{self, EntryArguments};
use crate::lower::scope::{self, BindingForm, BindingRef, ScopeSlot};
use crate::lower::{
    FileLowering, FunctionLowering, control, convert, expression, layouts, module, object,
    parameters, positions, statement,
};
use crate::modules::{ModuleRef, Shape};

type EntryValues = SmallVec<[(BindingRef, ValueId); 6]>;

pub(super) fn lower_commonjs_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    match variables::body_form(file) {
        BodyForm::Plain => lower_plain_body(file, function),
        BodyForm::Wrapped => lower_calling_body(file, function),
        BodyForm::NotCommonJs => unreachable!("the file is a CommonJS module"),
    }
}

fn finish_body(mut lowering: FunctionLowering<'_, '_, '_, '_, '_>, scope: Option<ScopeId>) {
    if let Some(scope) = scope {
        scope::leave_scope(&mut lowering, scope);
    }
    let undefined = lowering.builder.undefined();
    control::emit_return(&mut lowering, undefined, None);
    lowering.finish();
}

fn has_exports_variable(file: &FileLowering<'_, '_, '_, '_>, module: ModuleRef) -> bool {
    match file.inputs.modules.shape(module) {
        Shape::Value | Shape::AsToday => true,
        Shape::EsModule | Shape::Names => false,
    }
}

// The body begins as if it were written `exports = module.exports = {}`, with the layout of the names it stores.
fn emit_first_exports(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<ValueId> {
    if !has_exports_variable(lowering.file, module) {
        return None;
    }
    let variable = exports::ensure_exports_variable(lowering.file, module)?;
    let layout = match module {
        ModuleRef::File(file) => {
            let is_seen = variables::body_form(lowering.file) == BodyForm::Wrapped
                || layouts::begins_with_exports_object(lowering.file, file);
            if !is_seen {
                return None;
            }
            layouts::module_exports_layout(lowering.file, file)
        }
        ModuleRef::Inner { .. }
        | ModuleRef::Face(_)
        | ModuleRef::Check(_)
        | ModuleRef::Runtime(_)
        | ModuleRef::External { .. } => None,
    };
    let layout = layout.unwrap_or_else(|| layouts::untyped_layout(lowering.file, &[]));
    let builder = object::begin_object(lowering, layout);
    let created = object::finish_object(lowering, builder);
    lowering.builder.put_module_variable(variable, created);
    Some(created)
}

pub(super) fn set_own_exports(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) {
    let own_module = ModuleRef::File(lowering.file.file);
    if !has_exports_variable(lowering.file, own_module) {
        return;
    }
    if let Some(variable) = exports::ensure_exports_variable(lowering.file, own_module) {
        lowering.builder.put_module_variable(variable, value);
    }
}

fn lower_plain_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    let scope = module::file_scope(file);
    let own_module = ModuleRef::File(file.file);
    let mut lowering = FunctionLowering::begin(file, function);
    let first_exports = emit_first_exports(&mut lowering, own_module);
    enter_plain_file_scope(&mut lowering, scope, first_exports);
    statement::lower_file_statements(&mut lowering);
    finish_body(lowering, Some(scope));
}

// `this` at the top is the object that the body begins with. None of the five names is read from the scope.
fn enter_plain_file_scope(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    first_exports: Option<ValueId>,
) {
    let mut entry_values = EntryValues::new();
    let slots = WRAPPER_PARAMETERS.into_iter().map(ScopeSlot::CommonJs);
    for slot in [ScopeSlot::This].into_iter().chain(slots) {
        let binding = BindingRef::Slot(scope, slot);
        if lowering.file.scopes.placement(binding).is_none() {
            continue;
        }
        let value = match (slot, first_exports) {
            (ScopeSlot::This, Some(first_exports)) => first_exports,
            _ => lowering.builder.undefined(),
        };
        entry_values.push((binding, value));
    }
    if let Some(first_exports) = first_exports {
        variables::store_first_exports(lowering, first_exports);
    }
    scope::allocate_scope(lowering, scope, &entry_values);
    scope::instantiate_functions(lowering, scope);
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

fn declare_wrapped_body(file: &mut FileLowering<'_, '_, '_, '_>) -> FunctionId {
    let key = FunctionKey::WrappedModuleBody(file.file);
    file.declare_function(key, create_wrapped_header)
}

// A file that stores to one of the five names, or shows them to code that finds names at run time, has them as the parameters they are to `bun run`.
fn lower_calling_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    let wrapped = declare_wrapped_body(file);
    let own_module = ModuleRef::File(file.file);
    let mut lowering = FunctionLowering::begin(file, function);
    let first_exports = match emit_first_exports(&mut lowering, own_module) {
        Some(first_exports) => first_exports,
        None => lowering.builder.undefined(),
    };
    let mut values: SmallVec<[ValueId; 5]> = SmallVec::new();
    for variable in WRAPPER_PARAMETERS {
        values.push(match variable {
            CommonJsVariable::Exports => first_exports,
            CommonJsVariable::Require
            | CommonJsVariable::Module
            | CommonJsVariable::Filename
            | CommonJsVariable::Dirname => variables::emit_passed_value(&mut lowering, variable),
        });
    }
    let arguments = EntryArguments {
        this: Some(first_exports),
        new_target: None,
        parameters: &values,
    };
    function::emit_direct_call(&mut lowering, wrapped, arguments);
    finish_body(lowering, None);
}

pub(super) fn lower_wrapped_body(file: &mut FileLowering<'_, '_, '_, '_>, function: FunctionId) {
    let scope = module::file_scope(file);
    let mut lowering = FunctionLowering::begin(file, function);
    enter_wrapped_file_scope(&mut lowering, scope);
    statement::lower_file_statements(&mut lowering);
    finish_body(lowering, Some(scope));
}

fn enter_wrapped_file_scope(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, scope: ScopeId) {
    let mut entry_values = EntryValues::new();
    collect_arguments_object(lowering, scope, &mut entry_values);
    collect_wrapper_parameters(lowering, scope, &mut entry_values);
    collect_redeclared_variables(lowering, &mut entry_values);
    scope::allocate_scope(lowering, scope, &entry_values);
    scope::instantiate_functions(lowering, scope);
}

fn collect_arguments_object(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    entry_values: &mut EntryValues,
) {
    let indexes = 0..WRAPPER_PARAMETERS.len() as u32;
    let values: SmallVec<[ValueId; 5]> =
        indexes.map(|index| lowering.builder.parameter(index)).collect();
    let object = parameters::create_arguments_object(lowering, CodeUnit::File, &values);
    if let Some(object) = object {
        entry_values.push((BindingRef::Slot(scope, ScopeSlot::Arguments), object));
    }
}

fn collect_wrapper_parameters(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    scope: ScopeId,
    entry_values: &mut EntryValues,
) {
    for variable in WRAPPER_PARAMETERS {
        let binding = BindingRef::Slot(scope, ScopeSlot::CommonJs(variable));
        if lowering.file.scopes.placement(binding).is_none() {
            continue;
        }
        let value = emit_commonjs_entry_value(lowering, variable);
        entry_values.push((binding, value));
    }
}

fn collect_redeclared_variables(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    entry_values: &mut EntryValues,
) {
    let bound = lowering.file.bound;
    for &(symbol, variable) in bound.runtime.redeclared_commonjs_variables() {
        let binding = BindingRef::Symbol(symbol);
        if lowering.file.scopes.placement(binding).is_none() {
            continue;
        }
        let value = emit_commonjs_entry_value(lowering, variable);
        let position = positions::binding_position(lowering.file, symbol);
        let value = convert::convert(lowering, value, position, None);
        entry_values.push((binding, value));
    }
}

fn find_inner_module(file: &FileLowering<'_, '_, '_, '_>, callback: FnId) -> ModuleRef {
    let module = file.inputs.modules.inner_module(file.file, callback);
    module.expect("the function is the callback of an inner module")
}

// The callback of `__commonJS(cb)` or `__esm(fn)` is the body of a module: nobody passes it anything, and nobody gets what it returns.
pub(super) fn declare_inner_module_body(
    file: &mut FileLowering<'_, '_, '_, '_>,
    callback: FnId,
) -> FunctionId {
    function::declare_source_function_with(file, callback, &mut |_, header| {
        header.kind = FunctionKind::CommonJsModule;
        header.flags = header.flags.without(FunctionFlags::HAS_THIS);
        header.this_type = DeclaredType::untyped();
        header.length = 0;
        header.parameters = Vec::new();
        header.results = vec![DeclaredType::untyped()];
    })
}

pub(super) fn lower_inner_module_body(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    callback: FnId,
) {
    let module = find_inner_module(file, callback);
    let scope = file.bound.fns[callback.idx()].scope;
    let [exports_name, module_name] = exports::inner_parameters(file, callback);
    let mut lowering = FunctionLowering::begin(file, function);
    let first_exports = emit_first_exports(&mut lowering, module);
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
    scope::allocate_scope(&mut lowering, scope, &entry_values);
    scope::instantiate_functions(&mut lowering, scope);
    match lowering.file.hir[callback].body {
        FnBody::Block(statements) => statement::lower_statements(&mut lowering, statements),
        FnBody::Expr(value) => expression::lower_expression_for_effect(&mut lowering, value),
        FnBody::None => {}
    }
    finish_body(lowering, Some(scope));
}
