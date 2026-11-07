mod body;
mod exports;
mod variables;

pub(in crate::lower) use self::exports::{emit_module_value, is_erased, lower_export_reference};
#[cfg(test)]
pub(in crate::lower) use self::variables::WRAPPER_PARAMETERS;
pub(in crate::lower) use self::variables::{
    BodyForm, CommonJsState, find_wrapper_path, keeps_wrapper, path_variable_key, prepare,
    undeclared_wrapper_parameters, variables_seen_by_direct_eval, wrapper_parameter_index,
};
