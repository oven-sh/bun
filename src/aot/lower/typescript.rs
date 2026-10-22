mod aliases;
mod containers;
mod enum_values;
mod enums;

use bun_sema::hir::{self, EnumId, ExprId, ImportEqualsId};

use super::FunctionLowering;

pub(crate) fn lower_enum(lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>, declaration: EnumId) {
    enums::lower_enum(lowering, declaration);
}

pub(crate) fn lower_namespace(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: hir::ModuleId,
) {
    containers::lower_namespace(lowering, declaration);
}

pub(crate) fn lower_import_equals(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    declaration: ImportEqualsId,
) {
    aliases::lower_import_equals(lowering, declaration);
}

pub(crate) fn lower_export_assignment(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    expression: ExprId,
) {
    aliases::lower_export_assignment(lowering, expression);
}
