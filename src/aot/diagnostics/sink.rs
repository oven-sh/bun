use std::borrow::Cow;

use bun_ast::{Data, Kind, Log, Msg};
use bun_sema::check::aot::{Effect, FileOrigin, effect_of};
use bun_sema::program::Files;
use bun_sema::util::SharedSort;
use bun_sema_driver::{self as driver, log_message};
use rustc_hash::FxHashMap;

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
            owned_strings: Vec::new(),
            internal_errors: Vec::new(),
            int32_flows: FxHashMap::default(),
            error_count: 0,
        }
    }

    pub(crate) fn has_errors(&self) -> bool {
        self.error_count > 0 || self.has_internal_errors()
    }

    pub(crate) fn has_internal_errors(&self) -> bool {
        !self.internal_errors.is_empty()
    }

    pub(crate) fn paths_of_errors(&self) -> Option<Vec<&[u8]>> {
        if self.has_internal_errors() {
            return None;
        }
        let errors = self
            .entries
            .iter()
            .filter(|entry| entry.message.kind == Kind::Err);
        errors
            .map(|entry| Some(entry.key.1.as_slice()).filter(|path| !path.is_empty()))
            .collect()
    }

    pub(super) fn add_message(&mut self, code: u32, message: Msg) {
        if message.kind == Kind::Err {
            self.error_count += 1;
        }
        self.entries.push(Entry::new(code, message));
    }

    pub(super) fn report_internal_error(&mut self, stage: Stage, message: Vec<u8>) {
        self.internal_errors.push(InternalError { stage, message });
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
        self.owned_strings.extend(lists.log.owned_strings);
        self.internal_errors.extend(lists.internal_errors);
    }

    pub(crate) fn write_to(mut self, log: &mut Log) {
        self.entries.shared_sort_by(|a, b| a.key.cmp(&b.key));
        self.entries
            .dedup_by(|next, previous| next.key == previous.key);
        for entry in self.entries {
            write_message(log, entry.message);
        }
        log.owned_strings.append(&mut self.owned_strings);
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
        reported.path = position.path.clone();
        reported.has_undefined_range = false;
        (reported.line, reported.column) = (position.line, position.column);
        (reported.source, reported.source_line) = (vec![line_text.clone()], position.line);
    }
    write_message(log, to_log_message(&reported, severity));
}

/// For an error found after the diagnostics of the build were written.
pub fn log_internal_error(log: &mut Log, error: InternalError) {
    write_internal_errors(log, vec![error]);
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
