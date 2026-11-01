use std::borrow::Cow;

use bun_ast::{Data, Kind, Log, Msg};
use bun_sema::check::aot::{Effect, FileOrigin, effect_of};
use bun_sema::program::Files;
use bun_sema::util::SharedSort;
use bun_sema_driver::{self as driver, log_message};
use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    COMPILER_DIAGNOSTIC_CLASS, Diagnostic, DiagnosticBuffer, Diagnostics, Entry, InternalError,
    LoadMessages, ProgramView, Severity, ShownPosition, Span, SpanLocator, new_driver_diagnostic,
};
use crate::diagnostic_codes::Code;
use crate::statistics::Stage;

pub(super) const MAX_PRINTED_INTERNAL_ERRORS: usize = 20;
const MAX_PRINTED_SOURCE_BYTES: usize = 80;
pub(super) const BUG_REPORT_REQUEST: &[u8] =
    b"This is a bug in Bun. Please report it at https://github.com/oven-sh/bun/issues";

impl Entry {
    fn new(code: u32, message: Msg) -> Entry {
        let (file, line, column) = match &message.data.location {
            Some(location) => (
                location.file.to_vec(),
                i64::from(location.line),
                i64::from(location.column),
            ),
            None => (Vec::new(), 0, 0),
        };
        let is_closing_note = message.kind == Kind::Note && message.data.location.is_none();
        let text = message.data.text.to_vec();
        Entry {
            key: (is_closing_note, file, line, column, code, text),
            message,
        }
    }
}

impl Diagnostics {
    pub(crate) fn new() -> Diagnostics {
        Diagnostics {
            entries: Vec::new(),
            internal_errors: Vec::new(),
            files_of_internal_errors: Vec::new(),
            int32_flows: FxHashMap::default(),
            error_count: 0,
            early_error_count: 0,
            files_of_early_errors: Vec::new(),
            files_nested_too_deeply: Vec::new(),
            missing_at_load: FxHashSet::default(),
            places_of_type_errors: None,
        }
    }

    pub(crate) fn has_errors(&self) -> bool {
        self.error_count > 0 || self.has_internal_errors()
    }

    pub(crate) fn has_internal_errors(&self) -> bool {
        !self.internal_errors.is_empty()
    }

    pub(crate) fn has_early_errors(&self) -> bool {
        !self.has_internal_errors() && self.early_error_count > 0
    }

    /// `None`: an error names no file, so it may be about any of them.
    pub(crate) fn paths_of_errors(&self) -> Option<Vec<&[u8]>> {
        if self.files_of_internal_errors.len() != self.internal_errors.len() {
            return None;
        }
        let names_file_in_text = Code::FileNestedTooDeeply.number();
        let errors = (self.entries.iter())
            .filter(|entry| entry.message.kind == Kind::Err && entry.key.4 != names_file_in_text);
        errors
            .map(|entry| entry.key.1.as_slice())
            .chain(self.files_of_internal_errors.iter().map(Vec::as_slice))
            .chain(self.files_nested_too_deeply.iter().map(Vec::as_slice))
            .map(|path| Some(path).filter(|path| !path.is_empty()))
            .collect()
    }

    /// The files that no run gets past either: JavaScript finds one of their errors before it runs them. And the files with errors that hold no code.
    pub(crate) fn files_that_fail_at_load(
        &self,
        holds_code: impl Fn(&[u8]) -> bool,
    ) -> Vec<Vec<u8>> {
        if self.has_internal_errors() {
            return Vec::new();
        }
        // JavaScript finds these when it parses or links the file, and the compiler has words of its own for them.
        let is_found_at_load = |entry: &Entry| {
            let code = entry.key.4;
            [
                Code::ExportNotFound,
                Code::AmbiguousExport,
                Code::InvalidRegExp,
                Code::InvalidRegExpFlags,
                Code::ImportStatementInCommonJs,
                Code::MacroInExportStar,
                Code::MacroInExportFrom,
                Code::UnknownBundleExport,
                Code::FeatureArgumentCount,
                Code::FeatureArgumentNotString,
                Code::FeatureFlagNotAscii,
                Code::FeatureOutsideCondition,
                Code::FeatureImportedTwice,
                // The compiler cannot hold it. Whether the loader can is the loader's to say.
                Code::NestedTooDeeply,
            ]
            .iter()
            .any(|it| it.number() == code)
                // What a loader says of the text that it was given: `add_load_messages`. `import("./notes", { with: { type: "json" } })`: the path says nothing of the loader.
                || code == 0
                || self.files_of_early_errors.contains(&entry.key.1)
        };
        let errors = || {
            let errors = self.entries.iter();
            errors.filter(|entry| entry.message.kind == Kind::Err)
        };
        let mut files: Vec<Vec<u8>> = errors()
            .map(|entry| &entry.key.1)
            .filter(|path| !path.is_empty())
            .filter(|path| {
                !holds_code(path)
                    || errors()
                        .filter(|entry| entry.key.1 == **path)
                        .any(is_found_at_load)
            })
            .cloned()
            .collect();
        files.extend_from_slice(&self.files_nested_too_deeply);
        files.shared_sort_unstable();
        files.dedup();
        files
    }

    /// `LoadOptions::left_to_loader`: the loader says what is wrong with them, where a test loads them.
    pub(crate) fn forget_errors_in(&mut self, files: &[Vec<u8>]) {
        if files.is_empty() {
            return;
        }
        let is_left = |path: &[u8]| files.binary_search_by(|file| file[..].cmp(path)).is_ok();
        let errors_before = self.entries.len();
        let named = Code::FileNestedTooDeeply;
        let texts_that_name_them: FxHashSet<Vec<u8>> = (self.files_nested_too_deeply.iter())
            .filter(|path| is_left(path))
            .map(|path| {
                let diagnostic = Diagnostic::new(named, None, &[path.as_slice()]);
                to_message(None, &diagnostic, None).data.text.to_vec()
            })
            .collect();
        self.files_nested_too_deeply.retain(|path| !is_left(path));
        self.entries.retain(|entry| {
            entry.message.kind != Kind::Err
                || !(is_left(&entry.key.1)
                    || (entry.key.4 == named.number()
                        && texts_that_name_them.contains(&entry.key.5)))
        });
        self.error_count -= (errors_before - self.entries.len()) as u32;
        let early_before = self.files_of_early_errors.len();
        self.files_of_early_errors.retain(|path| !is_left(path));
        self.early_error_count -= (early_before - self.files_of_early_errors.len()) as u32;
    }

    pub(crate) fn merge(&mut self, other: Diagnostics) {
        self.entries.extend(other.entries);
        self.internal_errors.extend(other.internal_errors);
        self.files_of_internal_errors
            .extend(other.files_of_internal_errors);
        self.int32_flows.extend(other.int32_flows);
        self.error_count += other.error_count;
        self.early_error_count += other.early_error_count;
        self.files_of_early_errors
            .extend(other.files_of_early_errors);
        self.files_nested_too_deeply
            .extend(other.files_nested_too_deeply);
        self.missing_at_load.extend(other.missing_at_load);
        if let Some(places) = other.places_of_type_errors {
            self.places_of_type_errors
                .get_or_insert_default()
                .extend(places);
        }
    }

    /// All that the checker says of the files of a project.
    pub(crate) fn note_places_of_type_errors(&mut self, checked: &[driver::BuildDiagnostic]) {
        let in_files = checked.iter().filter(|it| it.diagnostic.file.is_some());
        self.places_of_type_errors
            .get_or_insert_default()
            .extend(in_files.map(|it| (it.diagnostic.path.clone(), it.diagnostic.start)));
    }

    pub(crate) fn take_places_of_type_errors(&mut self) -> Option<Vec<(Vec<u8>, u32)>> {
        let mut places = self.places_of_type_errors.take()?;
        places.shared_sort_unstable();
        places.dedup();
        Some(places)
    }

    pub(super) fn add_message(&mut self, code: u32, message: Msg) {
        if message.kind == Kind::Err {
            self.error_count += 1;
        }
        self.entries.push(Entry::new(code, message));
    }

    pub(super) fn add_early_error(&mut self, code: u32, message: Msg) {
        debug_assert!(message.kind == Kind::Err);
        self.early_error_count += 1;
        let location = message.data.location.as_ref();
        self.files_of_early_errors
            .push(location.map_or(Vec::new(), |location| location.file.to_vec()));
        self.add_message(code, message);
    }

    pub(super) fn report_internal_error(&mut self, stage: Stage, message: Vec<u8>) {
        self.internal_errors.push(InternalError { stage, message });
    }

    /// A test run goes on without the test files that import `path`, as it does for an error of the user's in that file.
    pub(super) fn report_internal_error_in_file(
        &mut self,
        stage: Stage,
        message: Vec<u8>,
        path: Vec<u8>,
    ) {
        self.report_internal_error(stage, message);
        self.files_of_internal_errors.push(path);
    }

    pub(crate) fn add(&mut self, view: Option<ProgramView<'_, '_>>, diagnostic: Diagnostic) {
        let mut locator = view.map(SpanLocator::new);
        self.add_with_locator(locator.as_mut(), diagnostic);
    }

    #[allow(clippy::needless_pass_by_value)] // the end of the diagnostic
    pub(super) fn add_with_locator(
        &mut self,
        mut locator: Option<&mut SpanLocator<'_, '_>>,
        diagnostic: Diagnostic,
    ) {
        let code = diagnostic.code;
        let origin = match (locator.as_deref(), diagnostic.span) {
            (Some(locator), Some(span)) => locator.view().origin(span.file),
            (None, Some(_)) | (Some(_) | None, None) => FileOrigin::NoFile,
        };
        let effect = effect_of(
            origin,
            COMPILER_DIAGNOSTIC_CLASS,
            diagnostic.severity.category(),
        );
        match effect {
            // Roles are final when the compiler reports.
            Effect::StopsBuild | Effect::Warns | Effect::WithdrawsTrust => {
                let message = to_message(locator, &diagnostic, None);
                self.add_message(code.number(), message);
            }
            Effect::Dropped => {}
            Effect::InternalError => {
                let located = to_driver_diagnostic(locator.as_deref_mut(), &diagnostic);
                let mut message = format!("TS{}: ", code.number()).into_bytes();
                message.extend_from_slice(&located.text);
                if let (Some(locator), Some(span)) = (locator, diagnostic.span) {
                    let view = locator.view();
                    let path = view.sources.module_paths(span.file).display_path;
                    append_location(&mut message, path, located.line, located.column);
                    append_source_text(&mut message, view.files(), span);
                }
                self.report_internal_error(Stage::Lower, message);
            }
        }
    }

    pub(crate) fn add_buffer(&mut self, view: ProgramView<'_, '_>, buffer: DiagnosticBuffer) {
        let mut locator = SpanLocator::new(view);
        for diagnostic in buffer.diagnostics {
            self.add_with_locator(Some(&mut locator), diagnostic);
        }
        for flow in buffer.int32_flows {
            self.add_int32_flow(view, flow);
        }
    }

    #[allow(clippy::needless_pass_by_value)] // the end of the diagnostic
    pub(crate) fn add_with_checker_note(
        &mut self,
        diagnostic: Diagnostic,
        note: driver::Diagnostic,
    ) {
        let message = to_message(None, &diagnostic, Some(note));
        self.add_message(diagnostic.code.number(), message);
    }

    pub(crate) fn add_internal_error(&mut self, error: InternalError) {
        self.internal_errors.push(error);
    }

    pub(crate) fn add_load_messages(&mut self, messages: &LoadMessages) {
        let lists = std::mem::take(&mut *messages.lists.lock());
        for message in lists.log.msgs {
            self.add_message(0, message);
        }
        self.internal_errors.extend(lists.internal_errors);
    }

    /// An error that shows where the code of a file is nested too deeply says more than the one that names the file.
    fn drop_files_whose_nesting_is_shown(&mut self) {
        let (shown, named) = (Code::NestedTooDeeply, Code::FileNestedTooDeeply);
        if !(self.entries.iter()).any(|entry| entry.key.4 == named.number()) {
            return;
        }
        let shown = (self.entries.iter()).filter(|entry| entry.key.4 == shown.number());
        let texts: FxHashSet<Vec<u8>> = shown
            .map(|entry| {
                let diagnostic = Diagnostic::new(named, None, &[entry.key.1.as_slice()]);
                to_message(None, &diagnostic, None).data.text.to_vec()
            })
            .collect();
        self.entries
            .retain(|entry| entry.key.4 != named.number() || !texts.contains(&entry.key.5));
    }

    /// Beside another error, what the transpiler says of the file and what the engine says of a pattern on the line name one mistake twice.
    fn drop_what_another_error_says(&mut self) {
        let (of_file, of_line) = (Code::RefusedByTranspiler, Code::InvalidRegExp);
        let is_asked = |entry: &Entry| [of_file.number(), of_line.number()].contains(&entry.key.4);
        if !self.entries.iter().any(is_asked) {
            return;
        }
        let others = (self.entries.iter())
            .filter(|entry| entry.message.kind == Kind::Err && !is_asked(entry));
        let lines: FxHashSet<(Vec<u8>, i64)> = others
            .map(|entry| (entry.key.1.clone(), entry.key.2))
            .collect();
        let files: FxHashSet<&[u8]> = lines.iter().map(|(file, _)| file.as_slice()).collect();
        self.entries.retain(|entry| {
            let (_, file, line, _, code, _) = &entry.key;
            match *code {
                code if code == of_file.number() => !files.contains(file.as_slice()),
                code if code == of_line.number() => !lines.contains(&(file.clone(), *line)),
                _ => true,
            }
        });
    }

    /// An import that fails at load has its warning. The checker's warning of the same import says nothing more.
    fn drop_second_error_of_import(&mut self) {
        let missing = std::mem::take(&mut self.missing_at_load);
        self.entries.retain(|entry| {
            let (_, file, _, _, code, text) = &entry.key;
            *code != 2307
                || entry.message.kind != Kind::Warn
                || !missing.contains(&(file.clone(), text.clone()))
        });
    }

    pub(crate) fn write_to(mut self, log: &mut Log) {
        self.drop_files_whose_nesting_is_shown();
        self.drop_what_another_error_says();
        self.drop_second_error_of_import();
        self.entries.shared_sort_by(|a, b| a.key.cmp(&b.key));
        self.entries
            .dedup_by(|next, previous| next.key == previous.key);
        for entry in self.entries {
            write_message(log, entry.message);
        }
        write_internal_errors(log, self.internal_errors);
    }
}

pub fn log_diagnostic(log: &mut Log, code: Code, arguments: &[&[u8]]) {
    let diagnostic = Diagnostic::new(code, None, arguments);
    write_message(log, to_message(None, &diagnostic, None));
}

/// For a message about a place in the program that is found after the diagnostics of the build were written.
pub(crate) fn log_diagnostic_at(
    log: &mut Log,
    code: Code,
    arguments: &[&[u8]],
    place: Option<&ShownPosition>,
) {
    let severity = code.severity();
    let text = code.message(arguments);
    let mut reported = new_driver_diagnostic(code.number(), severity.category(), text, &[]);
    if let Some(ShownPosition {
        position,
        line_text,
    }) = place
    {
        reported.path.clone_from(&position.path);
        reported.has_undefined_range = false;
        (reported.line, reported.column) = (position.line, position.column);
        (reported.source, reported.source_line) = (vec![line_text.clone()], position.line);
    }
    write_message(log, to_log_message(&reported, severity));
}

pub(super) fn write_message(log: &mut Log, message: Msg) {
    match message.kind {
        Kind::Err => log.errors += 1,
        Kind::Warn => log.warnings += 1,
        Kind::Note | Kind::Debug | Kind::Verbose => {}
    }
    log.add_msg(message);
}

fn write_internal_errors(log: &mut Log, mut errors: Vec<InternalError>) {
    errors
        .shared_sort_by(|a, b| (a.stage as usize, &a.message).cmp(&(b.stage as usize, &b.message)));
    errors.dedup_by(|next, previous| {
        next.stage == previous.stage && next.message == previous.message
    });
    for error in errors.iter().take(MAX_PRINTED_INTERNAL_ERRORS) {
        let text = [
            b"internal compiler error (".as_slice(),
            error.stage.name().as_bytes(),
            b"): ",
            error.message.as_slice(),
        ]
        .concat();
        let request = data_without_location(Cow::Borrowed(BUG_REPORT_REQUEST));
        write_message(
            log,
            Msg {
                kind: Kind::Err,
                data: data_without_location(Cow::Owned(text)),
                notes: Box::new([request]),
                ..Default::default()
            },
        );
    }
    let omitted = errors.len().saturating_sub(MAX_PRINTED_INTERNAL_ERRORS);
    if omitted > 0 {
        let text = format!("{omitted} more internal errors").into_bytes();
        write_message(
            log,
            Msg {
                kind: Kind::Note,
                data: data_without_location(Cow::Owned(text)),
                ..Default::default()
            },
        );
    }
}

fn data_without_location(text: Cow<'static, [u8]>) -> Data {
    Data {
        text,
        location: None,
    }
}

pub(super) fn append_location(message: &mut Vec<u8>, path: &[u8], line: u32, column: u32) {
    message.extend_from_slice(b" at ");
    message.extend_from_slice(path);
    message.extend_from_slice(format!(":{line}:{column}").as_bytes());
}

fn append_source_text(message: &mut Vec<u8>, files: &Files<'_>, span: Span) {
    let text = &files.module(span.file).hir.text[..];
    let end = (span.end as usize).min(span.start as usize + MAX_PRINTED_SOURCE_BYTES);
    let Some(source) = text
        .get(span.start as usize..end)
        .filter(|source| !source.is_empty())
    else {
        return;
    };
    message.extend_from_slice(b": ");
    message.extend_from_slice(source);
}

pub(super) fn to_driver_diagnostic(
    locator: Option<&mut SpanLocator<'_, '_>>,
    diagnostic: &Diagnostic,
) -> driver::Diagnostic {
    let code = diagnostic.code;
    let number = code.number();
    let category = diagnostic.severity.category();
    let text = code.message(&diagnostic.arguments);
    let reported = new_driver_diagnostic(number, category, text, &diagnostic.arguments);
    match (locator, diagnostic.span) {
        (Some(locator), Some(span)) => locator.locate(span, reported),
        (None, Some(_)) => {
            debug_assert!(false, "a diagnostic with a span needs a ProgramView");
            reported
        }
        (Some(_) | None, None) => reported,
    }
}

pub(super) fn to_log_message(reported: &driver::Diagnostic, severity: Severity) -> Msg {
    let mut message = log_message(reported).expect("neither a suggestion nor a message");
    if severity == Severity::Note {
        message.kind = Kind::Note;
    }
    message
}

fn to_message(
    mut locator: Option<&mut SpanLocator<'_, '_>>,
    diagnostic: &Diagnostic,
    checker_note: Option<driver::Diagnostic>,
) -> Msg {
    let mut reported = to_driver_diagnostic(locator.as_deref_mut(), diagnostic);
    let related = diagnostic.related.iter();
    reported.related = related
        .map(|related| to_driver_diagnostic(locator.as_deref_mut(), related))
        .chain(checker_note)
        .collect();
    to_log_message(&reported, diagnostic.severity)
}
