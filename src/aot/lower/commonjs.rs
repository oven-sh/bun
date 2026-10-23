mod body;
mod exports;
mod variables;

use bun_sema::bind::CommonJsVariable;
use bun_sema::hir::ExprId;

use super::member::Reference;
use super::{FileLowering, FunctionLowering};
use crate::ir::ValueId;

pub(in crate::lower) use self::body::{
    declare_inner_module_body, lower_commonjs_body, lower_inner_module_body, lower_wrapped_body,
    set_own_exports,
};
pub(in crate::lower) use self::exports::test_holder;
pub(in crate::lower) use self::exports::{
    check_member_root, current_module, current_module_id, drops_returned_value, emit_module_value,
    find_destructured_module, is_erased, is_module_body, lower_export_member,
    lower_export_receiver, read_imported_name, read_named_export, try_lower_export_assignment,
    try_lower_export_definition, try_lower_exports_deletion, try_lower_exports_statement,
    try_lower_mention,
};
#[cfg(test)]
pub(in crate::lower) use self::variables::WRAPPER_PARAMETERS;
pub(crate) use self::variables::emit_module_builtin;
pub(in crate::lower) use self::variables::initialize_path_variables;
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

pub(crate) fn emit_commonjs_entry_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    variable: CommonJsVariable,
) -> ValueId {
    variables::emit_entry_value(lowering, variable)
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
