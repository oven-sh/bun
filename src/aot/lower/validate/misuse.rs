#[cfg(test)]
pub(super) mod tests;

use bun_sema::bind::{Binding, Parent, SymbolId};
use bun_sema::hir::{ExportSpecId, ExprId, ExprKind, NodeData};

use super::expected_result::{ValidatingFunction, find_validating_function};
use crate::builtins::id::BuiltinId;
use crate::diagnostic_codes::Code;
use crate::lower::FileLowering;
use crate::modules::ImportBinding;

impl FileLowering<'_, '_, '_, '_> {
    pub(in crate::lower) fn report_misused_compiler_functions(&mut self) {
        let mentioned = self.builtins.mentioned();
        let mentions = |id: BuiltinId| mentioned.binary_search(&id).is_ok();
        let mentions_validate = mentions(BuiltinId::BunBundleValidate);
        if mentions_validate {
            self.report_validate_values();
        }
        if mentions_validate || mentions(BuiltinId::BunJSON) {
            self.report_exported_compiler_functions();
        }
        if mentions(BuiltinId::BunJSONParse) {
            self.report_parsers_that_are_not_called();
        }
    }

    // `const parse = JSON.parse<User>`, `(JSON.parse<User>)(text)`: the type argument stands on no call.
    fn report_parsers_that_are_not_called(&mut self) {
        let hir = self.hir;
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Instantiation { expr: operand, .. } = hir[expression].kind else {
                continue;
            };
            if self.decisions().is_dead_expr(expression) {
                continue;
            }
            let operand = self.skip_type_syntax(operand);
            let builtin = self.builtins.builtin_of_expression(operand);
            if builtin.and_then(find_validating_function) != Some(ValidatingFunction::Parse) {
                continue;
            }
            let range = hir[operand].end as usize..hir[expression].end as usize;
            let written = hir.text.get(range).unwrap_or_default().trim_ascii();
            let written = written.strip_prefix(b"<").unwrap_or(written);
            let written = written.strip_suffix(b">").unwrap_or(written);
            self.report_at(expression, Code::TypedParseIsNotCalled, &[written]);
        }
    }

    fn report_validate_values(&mut self) {
        let hir = self.hir;
        for expression in (0..hir.exprs.len() as u32).map(ExprId) {
            let ExprKind::Ident(_) = hir[expression].kind else {
                continue;
            };
            if self.decisions().is_dead_expr(expression) {
                continue;
            }
            let builtin = self.builtins.builtin_of_expression(expression);
            let function = builtin.and_then(find_validating_function);
            if function == Some(ValidatingFunction::Validate) && !is_callee(self, expression) {
                self.report_at(expression, Code::ValidateIsNotAValue, &[]);
            }
        }
    }

    fn report_exported_compiler_functions(&mut self) {
        let hir = self.hir;
        for spec in (0..hir.export_specs.len() as u32).map(ExportSpecId) {
            let export = &hir[hir[spec].export];
            if export.has_module_specifier || export.type_only || hir[spec].type_only {
                continue;
            }
            let Binding::Symbol(symbol) = self.bound.exported_binding(spec) else {
                continue;
            };
            let Some(code) = self.classify_import(symbol) else {
                continue;
            };
            let span = self.span_of(NodeData::ExportSpec(spec));
            self.diagnostics.report(code, span, &[]);
        }
    }

    fn classify_import(&self, symbol: SymbolId) -> Option<Code> {
        let id = self.builtins.of_symbol(symbol)?.id;
        if find_validating_function(id) == Some(ValidatingFunction::Validate) {
            return Some(Code::ValidateIsNotAValue);
        }
        if id != BuiltinId::BunJSON {
            return None;
        }
        match self.inputs.modules.import_binding(self.file, symbol) {
            ImportBinding::Builtin(_) | ImportBinding::CapturedBuiltin { .. } => {
                Some(Code::JsonFromBunIsExported)
            }
            _ => None,
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
