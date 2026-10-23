mod body;
mod exports;
mod variables;

use bun_sema::atom::Atom;
use bun_sema::bind::CommonJsVariable;
use bun_sema::hir::{ExprId, FnId, StmtId};

use super::member::Reference;
use super::{FileLowering, FunctionLowering};
use crate::builtins::id::BuiltinId;
use crate::ir::{FunctionId, ModuleId, ValueId};
use crate::modules::ModuleRef;

pub(in crate::lower) use self::exports::test_holder;
#[cfg(test)]
pub(in crate::lower) use self::variables::WRAPPER_PARAMETERS;
pub(in crate::lower) use self::variables::{
    BodyForm, CommonJsState, body_form, is_commonjs_module, keeps_wrapper,
    undeclared_wrapper_parameters, wrapper_parameter_index,
};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum ReadPurpose {
    Value,
    TypeofOperand,
}

/// Before anything of the file is lowered.
pub(in crate::lower) fn prepare(file: &mut FileLowering<'_, '_, '_, '_>) {
    variables::prepare(file);
}

pub(crate) fn get_commonjs_variable(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> ValueId {
    variables::get_variable(lowering, variable, ReadPurpose::Value)
}

pub(crate) fn get_commonjs_variable_for_typeof(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> ValueId {
    variables::get_variable(lowering, variable, ReadPurpose::TypeofOperand)
}

pub(crate) fn set_commonjs_variable(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
    value: ValueId,
) {
    variables::set_variable(lowering, variable, value);
}

pub(in crate::lower) fn initialize_path_variables(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) {
    variables::initialize_path_variables(lowering);
}

pub(crate) fn emit_commonjs_entry_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> ValueId {
    variables::emit_entry_value(lowering, variable)
}

pub(crate) fn emit_module_builtin(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    builtin: BuiltinId,
) -> ValueId {
    variables::emit_module_builtin(lowering, builtin)
}

pub(in crate::lower) fn lower_commonjs_body(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
) {
    body::lower_commonjs_body(file, function);
}

pub(in crate::lower) fn lower_wrapped_body(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
) {
    body::lower_wrapped_body(file, function);
}

pub(in crate::lower) fn declare_inner_module_body(
    file: &mut FileLowering<'_, '_, '_, '_>,
    callback: FnId,
) -> FunctionId {
    body::declare_inner_module_body(file, callback)
}

pub(in crate::lower) fn lower_inner_module_body(
    file: &mut FileLowering<'_, '_, '_, '_>,
    function: FunctionId,
    callback: FnId,
) {
    body::lower_inner_module_body(file, function, callback);
}

pub(in crate::lower) fn current_module(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
) -> ModuleRef {
    exports::current_module(lowering)
}

pub(in crate::lower) fn current_module_id(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
) -> ModuleId {
    exports::current_module_id(lowering)
}

pub(in crate::lower) fn is_module_body(lowering: &FunctionLowering<'_, '_, '_, '_, '_>) -> bool {
    exports::is_module_body(lowering)
}

pub(in crate::lower) fn drops_returned_value(
    lowering: &FunctionLowering<'_, '_, '_, '_, '_>,
) -> bool {
    exports::drops_returned_value(lowering)
}

pub(in crate::lower) fn emit_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
) -> Option<ValueId> {
    exports::emit_module_value(lowering, module)
}

pub(in crate::lower) fn set_own_exports(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ValueId,
) {
    body::set_own_exports(lowering, value);
}

pub(in crate::lower) fn read_named_export(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    name: Atom,
) -> Option<ValueId> {
    exports::read_named_export(lowering, module, name)
}

pub(in crate::lower) fn read_imported_name(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    module: ModuleRef,
    name: Atom,
) -> Option<ValueId> {
    exports::read_imported_name(lowering, module, name)
}

pub(in crate::lower) fn try_lower_mention(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> Option<ValueId> {
    exports::try_lower_mention(lowering, expression)
}

pub(in crate::lower) fn check_member_root(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) {
    exports::check_member_root(lowering, access);
}

pub(in crate::lower) fn lower_export_member(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    exports::lower_export_member(lowering, access)
}

pub(in crate::lower) fn lower_export_receiver(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> ValueId {
    exports::lower_export_receiver(lowering, access)
}

pub(in crate::lower) fn lower_export_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<Reference> {
    match exports::lower_export_reference(lowering, access) {
        Some(reference) => Some(reference),
        None => exports::lower_module_exports_reference(lowering, access),
    }
}

pub(in crate::lower) fn try_lower_exports_deletion(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<ValueId> {
    exports::try_lower_exports_deletion(lowering, access)
}

pub(in crate::lower) fn try_lower_export_definition(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    call: ExprId,
) -> Option<ValueId> {
    exports::try_lower_export_definition(lowering, call)
}

pub(in crate::lower) fn find_destructured_module(
    file: &FileLowering<'_, '_, '_, '_>,
    source: ExprId,
) -> Option<ModuleRef> {
    exports::find_destructured_module(file, source)
}

pub(in crate::lower) fn try_lower_exports_statement(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) -> bool {
    exports::try_lower_exports_statement(lowering, expression)
}

pub(in crate::lower) fn try_lower_export_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: ExprId,
) -> bool {
    exports::try_lower_export_assignment(lowering, value)
}

pub(in crate::lower) fn is_erased(file: &FileLowering<'_, '_, '_, '_>, statement: StmtId) -> bool {
    exports::is_erased(file, statement)
}
