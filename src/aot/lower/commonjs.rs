mod body;
mod exports;
mod variables;

use bun_sema::bind::CommonJsVariable;
use bun_sema::hir::ExprId;

use super::member::Reference;
use super::{FileLowering, FunctionLowering};
use crate::ir::ValueId;

pub(in crate::lower) use self::exports::{emit_module_value, is_erased};
#[cfg(test)]
pub(in crate::lower) use self::variables::WRAPPER_PARAMETERS;
pub(in crate::lower) use self::variables::{
    BodyForm, CommonJsState, keeps_wrapper, undeclared_wrapper_parameters, wrapper_parameter_index,
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

impl FunctionLowering<'_, '_, '_, '_, '_> {
    pub(crate) fn get_commonjs_variable(&mut self, variable: CommonJsVariable) -> ValueId {
        self.get_variable(variable, ReadPurpose::Value)
    }

    pub(crate) fn get_commonjs_variable_for_typeof(
        &mut self,
        variable: CommonJsVariable,
    ) -> ValueId {
        self.get_variable(variable, ReadPurpose::TypeofOperand)
    }

    pub(crate) fn set_commonjs_variable(&mut self, variable: CommonJsVariable, value: ValueId) {
        self.set_variable(variable, value);
    }

    pub(crate) fn emit_commonjs_entry_value(&mut self, variable: CommonJsVariable) -> ValueId {
        variables::emit_entry_value(self, variable)
    }
}

pub(in crate::lower) fn lower_export_reference(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    access: ExprId,
) -> Option<Reference> {
    match exports::lower_export_reference(lowering, access) {
        Some(reference) => Some(reference),
        None => lowering.lower_module_exports_reference(access),
    }
}
