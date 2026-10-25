use std::borrow::Cow;

use bun_ast::{Data, Kind, Location, Log, Msg};
use bun_sema::check::aot::Effect;
use bun_sema::messages::Category;
use bun_sema::program::FileId;
use bun_sema_driver as driver;

use super::super::sink::{BUG_REPORT_REQUEST, MAX_PRINTED_INTERNAL_ERRORS};
use super::super::{
    Diagnostic, DiagnosticBuffer, Diagnostics, FileDiagnostic, InternalError, LoadMessages,
    Severity, SourcePosition, Span, SpanLocator, log_diagnostic,
};
use super::{checker_error, describe, file_named, kinds_and_texts, with_effect, written};
use crate::compile::testing::with_project_view;
use crate::diagnostic_codes::Code;
use crate::statistics::Stage;

const TWO_FILES: [(&str, &str); 2] = [
    ("main.ts", "import \"./b\";\nconst é = 1, x = 2;\n"),
    ("b.ts", "\nexport {};\n"),
];

fn written_errors(errors: Vec<driver::Diagnostic>) -> Log {
    let errors = errors.into_iter();
    let errors = errors.map(|error| with_effect(error, Effect::StopsBuild));
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_build_diagnostics(Stage::Check, errors.collect());
    written(diagnostics)
}

#[test]
fn output_order_ignores_insertion_order() {
    let errors = vec![
        checker_error("/project/b.ts", (1, 1), 2322, "in b"),
        checker_error("/project/a.ts", (2, 1), 2322, "second line"),
        checker_error("/project/a.ts", (1, 5), 2322, "higher code"),
        checker_error("/project/a.ts", (1, 5), 2304, "lower code"),
        checker_error("", (0, 0), 5083, "no file"),
    ];
    let reversed = errors.iter().rev().cloned().collect();
    let printed = describe(&written_errors(errors));
    assert_eq!(printed, describe(&written_errors(reversed)));
    assert_eq!(
        printed,
        [
            "Err TS5083: no file",
            "/project/a.ts:1:5 Err TS2304: lower code",
            "/project/a.ts:1:5 Err TS2322: higher code",
            "/project/a.ts:2:1 Err TS2322: second line",
            "/project/b.ts:1:1 Err TS2322: in b",
        ]
    );
}

#[test]
fn equal_entries_print_once() {
    let error = checker_error("/project/a.ts", (1, 5), 2322, "first");
    let log = written_errors(vec![error.clone(), error.clone()]);
    assert_eq!((log.msgs.len(), log.errors), (1, 1));

    let other_text = checker_error("/project/a.ts", (1, 5), 2322, "second");
    let log = written_errors(vec![error, other_text]);
    assert_eq!((log.msgs.len(), log.errors), (2, 2));
}

#[test]
fn notes_without_location_print_after_located_messages() {
    let mut diagnostics = Diagnostics::new();
    let note = Diagnostic::new(Code::TryRequireInstead, None, &[b"\"p\""]);
    diagnostics.add(None, note);
    let error = checker_error("/project/a.ts", (1, 5), 2322, "wrong type");
    diagnostics.add_build_diagnostics(Stage::Check, vec![with_effect(error, Effect::StopsBuild)]);
    assert_eq!(
        describe(&written(diagnostics)),
        [
            "/project/a.ts:1:5 Err TS2322: wrong type",
            "Note TS100111: Try require(\"p\") instead",
        ]
    );
}

#[test]
fn internal_errors_print_last_once_and_capped() {
    let mut diagnostics = Diagnostics::new();
    for index in (0..25).rev() {
        diagnostics.report_internal_error(Stage::LinkAndEmit, format!("{index:02}").into_bytes());
    }
    diagnostics.report_internal_error(Stage::LinkAndEmit, b"00".to_vec());
    diagnostics.report_internal_error(Stage::Load, b"zz".to_vec());
    diagnostics.add(None, Diagnostic::new(Code::MacrosDisabled, None, &[]));
    assert!(diagnostics.has_errors());
    assert!(diagnostics.has_internal_errors());

    let log = written(diagnostics);
    let printed = kinds_and_texts(&log);
    assert_eq!(printed.len(), 1 + MAX_PRINTED_INTERNAL_ERRORS + 1);
    assert_eq!(log.errors as usize, 1 + MAX_PRINTED_INTERNAL_ERRORS);
    assert_eq!(printed[0].1, "TS100053: Macros are disabled");
    assert_eq!(printed[1].1, "internal compiler error (Load): zz");
    assert_eq!(printed[2].1, "internal compiler error (LinkAndEmit): 00");
    assert_eq!(printed[3].1, "internal compiler error (LinkAndEmit): 01");
    assert_eq!(log.msgs[1].notes[0].text.as_ref(), BUG_REPORT_REQUEST);
    let last = (Kind::Note, "6 more internal errors".to_string());
    assert_eq!(printed.last(), Some(&last));
}

#[test]
fn internal_error_alone_fails_build() {
    let mut diagnostics = Diagnostics::new();
    assert!(!diagnostics.has_errors());
    diagnostics.add_internal_error(InternalError {
        stage: Stage::Any,
        message: b"broken".to_vec(),
    });
    assert!(diagnostics.has_errors());
    assert_eq!(
        kinds_and_texts(&written(diagnostics)),
        [(
            Kind::Err,
            "internal compiler error (Any): broken".to_string()
        )]
    );
}

#[test]
fn warnings_and_notes_do_not_fail_build() {
    let mut diagnostics = Diagnostics::new();
    let warning = Diagnostic::new(Code::FunctionIntrospection, None, &[b"f.caller"]);
    diagnostics.add(None, warning);
    let note = Diagnostic::new(Code::TryRequireInstead, None, &[b"\"p\""]);
    diagnostics.add(None, note);
    assert!(!diagnostics.has_errors());
    let log = written(diagnostics);
    assert_eq!((log.errors, log.warnings, log.msgs.len()), (0, 1, 2));
}

#[test]
fn log_diagnostic_prints_number_and_counts() {
    let mut log = Log::init();
    log_diagnostic(&mut log, Code::UnsupportedOption, &[b"--splitting"]);
    log_diagnostic(&mut log, Code::TryRequireInstead, &[b"\"shapes\""]);
    let unsupported = "TS100050: --aot does not support --splitting".to_string();
    let note = "TS100111: Try require(\"shapes\") instead".to_string();
    assert_eq!(
        kinds_and_texts(&log),
        [(Kind::Err, unsupported), (Kind::Note, note)]
    );
    assert_eq!((log.errors, log.warnings), (1, 0));
    assert!(log.msgs[0].data.location.is_none());
}

#[test]
fn with_log_keeps_strings_of_finished_calls() {
    let messages = LoadMessages::default();
    messages.with_log(|log| {
        let file = log.dupe(b"/project/plugin.ts");
        log.errors += 1;
        log.add_msg(Msg {
            kind: Kind::Err,
            data: Data {
                text: Cow::Borrowed(b"the plugin failed"),
                location: Some(Location {
                    file: Cow::Borrowed(file),
                    line: 3,
                    column: 4,
                    ..Default::default()
                }),
            },
            ..Default::default()
        });
    });
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_messages(&messages);
    assert!(diagnostics.has_errors());
    assert!(!diagnostics.has_internal_errors());
    let log = written(diagnostics);
    assert_eq!(
        describe(&log),
        ["/project/plugin.ts:3:4 Err the plugin failed"]
    );
    assert_eq!(log.errors, 1);

    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_messages(&messages);
    assert!(written(diagnostics).msgs.is_empty());
}

#[test]
fn load_messages_carry_diagnostics_and_internal_errors() {
    let messages = LoadMessages::default();
    messages.with_log(|log| log_diagnostic(log, Code::MacrosDisabled, &[]));
    messages.report_internal_error(b"no such loader".to_vec());
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_load_messages(&messages);
    assert!(diagnostics.has_internal_errors());
    assert_eq!(
        kinds_and_texts(&written(diagnostics)),
        [
            (Kind::Err, "TS100053: Macros are disabled".to_string()),
            (
                Kind::Err,
                "internal compiler error (Load): no such loader".to_string()
            ),
        ]
    );
}

#[test]
fn buffer_locates_spans_in_each_file() {
    with_project_view(&TWO_FILES, |view| {
        let main = view.files().entry_points()[0];
        let other = file_named(view, "/project/b.ts");
        let mut buffer = DiagnosticBuffer::default();
        for (file, start) in [(main, 20), (main, 28), (other, 1), (main, 0)] {
            let end = start;
            buffer.report(Code::FeatureArgumentCount, Span { file, start, end }, &[]);
        }
        let mut diagnostics = Diagnostics::new();
        diagnostics.add_buffer(view, buffer);
        let message = "Err TS100100: feature() requires exactly one string argument";
        assert_eq!(
            describe(&written(diagnostics)),
            [
                format!("/project/b.ts:2:1 {message}"),
                format!("/project/main.ts:1:1 {message}"),
                format!("/project/main.ts:2:7 {message}"),
                format!("/project/main.ts:2:14 {message}"),
            ]
        );
    });
}

#[test]
fn located_message_carries_source_line() {
    with_project_view(&TWO_FILES, |view| {
        let span = Span {
            file: view.files().entry_points()[0],
            start: 28,
            end: 29,
        };
        let mut diagnostics = Diagnostics::new();
        let diagnostic = Diagnostic::new(Code::FeatureArgumentCount, Some(span), &[]);
        diagnostics.add(Some(view), diagnostic);
        let log = written(diagnostics);
        let location = log.msgs[0].data.location.as_ref().expect("a location");
        let line = "const é = 1, x = 2;".as_bytes();
        assert_eq!(location.line_text.as_deref(), Some(line));
        assert_eq!((location.offset, location.length), (28, 1));
    });
}

#[test]
fn position_of_span_is_one_based() {
    with_project_view(&TWO_FILES, |view| {
        let file = view.files().entry_points()[0];
        let mut locator = SpanLocator::new(view);
        let mut position_at = |start| {
            let end = start;
            locator.position_of(Span { file, start, end })
        };
        let in_main = |line, column| SourcePosition {
            path: b"/project/main.ts".to_vec(),
            line,
            column,
        };
        assert_eq!(position_at(0), in_main(1, 1));
        assert_eq!(position_at(28), in_main(2, 14));
        assert_eq!(position_at(14), in_main(2, 1));
    });
}

#[test]
fn spans_order_by_file_then_range() {
    let span = |file, start, end| Span {
        file: FileId(file),
        start,
        end,
    };
    assert!(span(0, 9, 9) < span(1, 0, 0));
    assert!(span(1, 0, 5) < span(1, 1, 2));
    assert!(span(1, 1, 2) < span(1, 1, 3));
}

#[test]
fn notes_count_as_warnings_in_effect_table() {
    assert_eq!(Severity::Error.category(), Category::Error);
    assert_eq!(Severity::Warning.category(), Category::Warning);
    assert_eq!(Severity::Note.category(), Category::Warning);
}

#[test]
fn buffer_has_errors_only_with_error_severity() {
    let span = Span {
        file: FileId(0),
        start: 0,
        end: 0,
    };
    let mut buffer = DiagnosticBuffer::default();
    assert!(buffer.is_empty());
    buffer.report(Code::FunctionIntrospection, span, &[b"f.caller"]);
    assert!(!buffer.is_empty());
    assert!(!buffer.has_errors());

    let mut errors = DiagnosticBuffer::default();
    errors.report(Code::NestedTooDeeply, span, &[b"500"]);
    buffer.append(errors);
    assert!(buffer.has_errors());
    let codes: Vec<Code> = buffer.iter().map(|diagnostic| diagnostic.code).collect();
    assert_eq!(codes, [Code::FunctionIntrospection, Code::NestedTooDeeply]);
}

#[test]
fn file_diagnostic_takes_owner_file() {
    let in_file = FileDiagnostic::new(Code::MacroArgumentNotConstant, (4, 9), &[]);
    let diagnostic = in_file.into_diagnostic(FileId(3));
    let span = Span {
        file: FileId(3),
        start: 4,
        end: 9,
    };
    assert_eq!(diagnostic.code, Code::MacroArgumentNotConstant);
    assert_eq!(diagnostic.severity, Severity::Error);
    assert_eq!(diagnostic.span, Some(span));
    assert!(diagnostic.related.is_empty());
}
