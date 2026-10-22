use crate::check::Checker;
use crate::check::errors_type_nodes::has_parse_diagnostics;
use crate::hir::FileKind;
use crate::program::FileId;

mod classes;
mod declarations;
mod error_classes;
mod expressions;
mod names;
mod patterns;
mod report;
mod sink;
mod statements;
mod syntax_class;

pub(in crate::check) use error_classes::is_instance_constructor_name;

impl Checker<'_, '_> {
    pub(in crate::check) fn check_early_errors(&mut self, file: FileId) {
        let hir = self.hir(file);
        match hir.kind {
            FileKind::Declaration | FileKind::Json => return,
            FileKind::Ts | FileKind::Tsx => {}
        }
        self.check_redeclaration_early_errors(file);
        self.check_export_early_errors(file);
        self.check_statement_early_errors(file);
        self.check_function_early_errors(file);
        self.check_class_early_errors(file);
        self.check_binding_pattern_early_errors(file);
        self.check_reserved_name_early_errors(file);
        self.check_strict_mode(file, !has_parse_diagnostics(hir));
        self.check_strict_mode_statements(file);
        self.check_eval_or_arguments_early_errors(file);
        self.check_expression_early_errors(file);
    }
}
