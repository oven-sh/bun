#[cfg(test)]
pub(super) mod tests;

use bun_sema::bind::{Binding, Parent, SymbolId};
use bun_sema::hir::{ExportSpecId, ExprId, ExprKind, NodeData};

use super::expected_result::{ValidatingFunction, find_validating_function, report_at};
use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::lower::FileLowering;
use crate::modules::ImportBinding;

pub(super) fn report_misused_compiler_functions(file: &mut FileLowering<'_, '_, '_, '_>) {
    let mentioned = file.builtins.mentioned();
    let mentions = |id: BuiltinId| mentioned.binary_search(&id).is_ok();
    let mentions_validate = mentions(BuiltinId::BunBundleValidate);
    if mentions_validate {
        report_validate_values(file);
    }
    if mentions_validate || mentions(BuiltinId::JSON) {
        report_exported_compiler_functions(file);
    }
}

fn report_validate_values(file: &mut FileLowering<'_, '_, '_, '_>) {
    let hir = file.hir;
    for expression in (0..hir.exprs.len() as u32).map(ExprId) {
        let ExprKind::Ident(_) = hir[expression].kind else {
            continue;
        };
        if file.decisions().is_dead_expr(expression) {
            continue;
        }
        let builtin = file.builtins.builtin_of_expression(expression);
        let function = builtin.and_then(find_validating_function);
        if function == Some(ValidatingFunction::Validate) && !is_callee(file, expression) {
            report_at(file, expression, Code::ValidateIsNotAValue, &[]);
        }
    }
}

fn is_callee(file: &FileLowering<'_, '_, '_, '_>, expression: ExprId) -> bool {
    let Parent::Expr(parent) = file.bound.parent_of_expr(expression) else {
        return false;
    };
    let Some(parent) = file.hir.exprs.get(parent.idx()) else {
        return false;
    };
    matches!(parent.kind, ExprKind::Call(call) if file.hir[call].callee == expression)
}

fn report_exported_compiler_functions(file: &mut FileLowering<'_, '_, '_, '_>) {
    let hir = file.hir;
    for spec in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
        let export = &hir[hir[spec].export];
        if export.has_module_specifier || export.type_only || hir[spec].type_only {
            continue;
        }
        let Binding::Symbol(symbol) = file.bound.exported_binding(spec) else {
            continue;
        };
        let Some(code) = classify_import(file, symbol) else {
            continue;
        };
        let span = file.span_of(NodeData::ExportSpec(spec));
        file.diagnostics.report(code, span, &[]);
    }
}

fn classify_import(file: &FileLowering<'_, '_, '_, '_>, symbol: SymbolId) -> Option<Code> {
    let id = file.builtins.of_symbol(symbol)?.id;
    if find_validating_function(id) == Some(ValidatingFunction::Validate) {
        return Some(Code::ValidateIsNotAValue);
    }
    if id != BuiltinId::JSON {
        return None;
    }
    match file.inputs.modules.import_binding(file.file, symbol) {
        ImportBinding::Builtin(_) | ImportBinding::CapturedBuiltin { .. } => {
            Some(Code::JsonFromBunIsExported)
        }
        _ => None,
    }
}
