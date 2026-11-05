mod body;
mod exports;
mod variables;

pub(in crate::lower) use self::exports::{emit_module_value, is_erased, lower_export_reference};
#[cfg(test)]
pub(in crate::lower) use self::variables::WRAPPER_PARAMETERS;
pub(in crate::lower) use self::variables::{
    BodyForm, CommonJsState, keeps_wrapper, prepare, undeclared_wrapper_parameters,
    wrapper_parameter_index,
};
