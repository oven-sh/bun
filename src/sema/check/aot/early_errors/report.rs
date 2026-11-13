use crate::check::aot::DiagnosticClass;
use crate::check::errors_aliases::Directives;
use crate::check::sink::Reported;
use crate::check::{Checker, Requested};
use crate::hir::{DiagnosticKind, FileKind, Flags};
use crate::messages;
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

    fn find_early_errors(&mut self, file: FileId, keeps_grammar: bool) -> Vec<Reported> {
        let from = self.reported.len();
        if !self.hir(file).has_parse_diagnostics {
            self.report_hir_diagnostics(file, &[DiagnosticKind::Grammar]);
        }
        self.report_hir_diagnostics(file, &[DiagnosticKind::Checker]);
        let mut from_parser = self.reported.len() - from;
        self.check_early_errors(file);
        let mut found = self.reported.split_off(from);
        let hir = self.hir(file);
        found.retain(|d| {
            let is_from_parser = from_parser > 0;
            from_parser = from_parser.saturating_sub(1);
            let is_kept = match d.class {
                DiagnosticClass::EarlyError => true,
                DiagnosticClass::TypeScriptGrammar => keeps_grammar && is_from_parser,
                _ => false,
            };
            d.file == file && is_kept && !hir.is_in_jsdoc(d.start)
        });
        if !hir.copied_factories.is_empty() {
            found.retain(|d| !hir.is_in_copied_factory(d.start));
        }
        if !hir.known_evaluations.is_empty() {
            let end = hir.written_text_end();
            let (written, evaluated): (Vec<_>, Vec<_>) =
                found.into_iter().partition(|d| d.start <= end);
            found = written;
            hir.set_early_errors_in_evaluations(evaluated.iter().map(|d| d.start).collect());
        }
        let early_errors = found
            .iter()
            .filter(|d| d.class == DiagnosticClass::EarlyError);
        if let Some(first) = early_errors.min_by_key(|d| (d.start, d.code)) {
            let mut sentence = Vec::new();
            if let Some((_, template)) = messages::message(first.code) {
                messages::format(&mut sentence, template, &first.args);
            }
            self.file_with_early_error = Some(file);
            self.first_early_error = (sentence, first.start);
        }
        found
    }

    pub fn found_early_error(&self, file: FileId) -> bool {
        self.file_with_early_error == Some(file)
    }

    pub fn first_early_error(&self, file: FileId) -> Option<(&[u8], u32)> {
        let (sentence, start) = &self.first_early_error;
        self.found_early_error(file)
            .then_some((&sentence[..], *start))
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
        let found = self.find_early_errors(file, true).into_iter();
        let mut directives = Directives::default();
        (found.filter_map(|d| self.settled(d, &mut directives))).collect()
    }

    pub(in crate::check) fn report_early_errors(&mut self, file: FileId) {
        if !self.is_in_compile_build(file) {
            return;
        }
        let found = self.find_early_errors(file, false);
        self.reported.extend(found);
    }

    pub(in crate::check) fn is_unconditional_error(&self, d: &Reported) -> bool {
        d.class == DiagnosticClass::EarlyError && self.is_in_compile_build(d.file)
    }
}
