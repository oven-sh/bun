use crate::check::aot::DiagnosticClass;
use crate::check::errors_aliases::Directives;
use crate::check::sink::Reported;
use crate::check::{Checker, Requested};
use crate::hir::{DiagnosticKind, FileKind, Flags};
use crate::program::FileId;

impl Checker<'_, '_> {
    fn reports_early_errors_alone(&self, file: FileId) -> bool {
        match self.expected {
            Requested::EarlyErrors | Requested::All => self.is_in_compile_build(file),
            Requested::Syntactic | Requested::Types | Requested::Declaration => false,
        }
    }

    fn prepare_grammar_checks(&mut self, file: FileId) {
        let hir = self.hir(file);
        let mut modifiers = hir.modifiers.iter();
        self.has_ambient_context = hir.kind == FileKind::Declaration
            || modifiers.any(|modifier| modifier.kind.flag() == Flags::AMBIENT);
        self.reparsed_for_await = None;
    }

    fn find_early_errors(&mut self, file: FileId) -> Vec<Reported> {
        let from = self.reported.len();
        if !self.hir(file).has_parse_diagnostics {
            self.report_hir_diagnostics(file, &[DiagnosticKind::Grammar]);
        }
        self.report_hir_diagnostics(file, &[DiagnosticKind::Checker]);
        self.check_early_errors(file);
        let mut found = self.reported.split_off(from);
        found.retain(|d| d.file == file && d.class == DiagnosticClass::EarlyError);
        if !found.is_empty() {
            self.file_with_early_error = Some(file);
        }
        found
    }

    pub fn found_early_error(&self, file: FileId) -> bool {
        self.file_with_early_error == Some(file)
    }

    pub(in crate::check) fn early_errors_of_unchecked_file(
        &mut self,
        file: FileId,
    ) -> Vec<Reported> {
        let is_json = self.hir(file).kind == FileKind::Json;
        if is_json || !self.reports_early_errors_alone(file) {
            return Vec::new();
        }
        self.prepare_grammar_checks(file);
        let found = self.find_early_errors(file).into_iter();
        let mut directives = Directives::default();
        (found.filter_map(|d| self.settled(d, &mut directives))).collect()
    }

    pub(in crate::check) fn report_early_errors(&mut self, file: FileId) {
        if !self.is_in_compile_build(file) {
            return;
        }
        let found = self.find_early_errors(file);
        self.reported.extend(found);
    }

    pub(in crate::check) fn is_unconditional_error(&self, d: &Reported) -> bool {
        d.class == DiagnosticClass::EarlyError && self.is_in_compile_build(d.file)
    }
}
