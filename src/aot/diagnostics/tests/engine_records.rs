use bun_ast::{Kind, Log};

use super::super::Diagnostics;
use super::super::engine_records::internal_error_text;
use super::{describe, kinds_and_texts, text, written};
use crate::engine::{InternalErrorRecord, SourceLocation, TextRange, UserDiagnosticRecord};
use crate::ir::generated::{
    DiagnosticSeverity, InternalErrorKind, LimitId, PassId, TypeSiteKind, UserDiagnosticKind,
};
use crate::ir::ids::{ABSENT_WORD, ModuleId};
use crate::link::{ModuleOrigin, ProgramNames};
use crate::report::{ModuleLocator, ModuleSource, SourceTexts};

const PROGRAM: u32 = 0;
const DEPENDENCY: u32 = 1;
const RUNTIME: u32 = 2;
const NO_LOCATION: SourceLocation = SourceLocation {
    module: ABSENT_WORD,
    position: 0,
};
const NO_TEXT: TextRange = TextRange {
    offset: 0,
    length: 0,
};
const ERROR: UserDiagnosticKind = UserDiagnosticKind::InvalidRegExpLiteral;
const WARNING: UserDiagnosticKind = UserDiagnosticKind::RegExpWithoutCode;

fn names() -> ProgramNames {
    ProgramNames::from_lists(
        &[
            (&b"render"[..], Some(ModuleId::from_word(PROGRAM))),
            (&b""[..], Some(ModuleId::from_word(DEPENDENCY))),
        ],
        &[&b"Item"[..], b""],
        &[
            (&b"/p/a.ts"[..], ModuleOrigin::Program),
            (&b"/p/node_modules/b/b.js"[..], ModuleOrigin::Dependency),
            (&b"node:http"[..], ModuleOrigin::Runtime),
        ],
    )
}

fn texts() -> SourceTexts {
    let source = |path: &str, text: &str| Some(ModuleSource::new(path.as_bytes(), text.as_bytes()));
    SourceTexts::new(vec![
        source("/p/a.ts", "first;\nsecond;\n"),
        source("/p/node_modules/b/b.js", "dependency;\n"),
        source("node:http", "runtime;\n"),
    ])
}

fn at(module: u32, position: u32) -> SourceLocation {
    SourceLocation { module, position }
}

fn user_diagnostic(kind: UserDiagnosticKind, location: SourceLocation) -> UserDiagnosticRecord {
    UserDiagnosticRecord {
        kind,
        function: ABSENT_WORD,
        block: ABSENT_WORD,
        value: ABSENT_WORD,
        layout: ABSENT_WORD,
        limit: LimitId::None,
        count: 0,
        location,
        message: NO_TEXT,
        origin: NO_LOCATION,
        site_kind: TypeSiteKind::Unknown,
        minimum: 0.0,
        maximum: 0.0,
    }
}

fn internal_error(function: u32, layout: u32, location: SourceLocation) -> InternalErrorRecord {
    InternalErrorRecord {
        kind: InternalErrorKind::UseNotDominated,
        function,
        block: ABSENT_WORD,
        value: ABSENT_WORD,
        layout,
        limit: LimitId::None,
        pass: PassId::None,
        count: 0,
        location,
        message: NO_TEXT,
    }
}

fn add_all(records: &[(UserDiagnosticRecord, &str)]) -> Diagnostics {
    let (names, texts) = (names(), texts());
    let mut locator = ModuleLocator::new(&texts);
    let mut diagnostics = Diagnostics::new();
    for (record, text) in records {
        diagnostics.add_user_diagnostic(record, text.as_bytes(), &names, &mut locator);
    }
    diagnostics
}

fn written_record(kind: UserDiagnosticKind, location: SourceLocation) -> Log {
    written(add_all(&[(
        user_diagnostic(kind, location),
        "said by the engine",
    )]))
}

fn internal_text(record: &InternalErrorRecord, engine_text: &str) -> String {
    let texts = texts();
    let mut locator = ModuleLocator::new(&texts);
    text(&internal_error_text(
        record,
        engine_text.as_bytes(),
        &names(),
        &mut locator,
    ))
}

#[test]
fn chosen_kinds_have_expected_severity() {
    assert_eq!(ERROR.severity(), DiagnosticSeverity::Error);
    assert_eq!(WARNING.severity(), DiagnosticSeverity::Warning);
}

#[test]
fn engine_warning_prints_number_and_compiled_line() {
    let diagnostics = add_all(&[(user_diagnostic(WARNING, at(PROGRAM, 7)), "runs slowly")]);
    assert!(!diagnostics.has_errors());
    let log = written(diagnostics);
    let number = WARNING.code();
    assert_eq!(
        describe(&log),
        [format!("/p/a.ts:2:1 Warn TS{number}: runs slowly")]
    );
    let location = log.msgs[0].data.location.as_ref().expect("a location");
    assert_eq!(location.line_text.as_deref(), Some(&b"second;"[..]));
    assert_eq!((log.errors, log.warnings), (0, 1));
}

#[test]
fn engine_error_stops_build() {
    let diagnostics = add_all(&[(user_diagnostic(ERROR, at(PROGRAM, 0)), "cannot be compiled")]);
    assert!(diagnostics.has_errors());
    assert!(!diagnostics.has_internal_errors());
    let number = ERROR.code();
    assert_eq!(
        describe(&written(diagnostics)),
        [format!("/p/a.ts:1:1 Err TS{number}: cannot be compiled")]
    );
}

#[test]
fn engine_error_in_dependency_stops_build() {
    let log = written_record(ERROR, at(DEPENDENCY, 0));
    let number = ERROR.code();
    assert_eq!(
        describe(&log),
        [format!(
            "/p/node_modules/b/b.js:1:1 Err TS{number}: said by the engine"
        )]
    );
}

#[test]
fn engine_record_without_location_has_none() {
    let log = written_record(ERROR, NO_LOCATION);
    assert_eq!(log.msgs.len(), 1);
    assert_eq!(log.msgs[0].kind, Kind::Err);
    assert!(log.msgs[0].data.location.is_none());
}

#[test]
fn engine_record_in_module_without_text_has_no_location() {
    let names = ProgramNames::from_lists(&[], &[], &[(&b"data.json"[..], ModuleOrigin::Program)]);
    let texts = SourceTexts::new(vec![None]);
    let mut diagnostics = Diagnostics::new();
    let record = user_diagnostic(ERROR, at(PROGRAM, 3));
    diagnostics.add_user_diagnostic(&record, b"x", &names, &mut ModuleLocator::new(&texts));
    let log = written(diagnostics);
    assert_eq!(log.msgs.len(), 1);
    assert!(log.msgs[0].data.location.is_none());
}

#[test]
fn engine_error_in_runtime_module_is_internal() {
    let diagnostics = add_all(&[(user_diagnostic(ERROR, at(RUNTIME, 0)), "cannot be compiled")]);
    assert!(diagnostics.has_internal_errors());
    let stage = ERROR.stage().name();
    assert_eq!(
        kinds_and_texts(&written(diagnostics)),
        [(
            Kind::Err,
            format!("internal compiler error ({stage}): cannot be compiled at node:http")
        )]
    );
}

#[test]
fn engine_warning_in_runtime_module_is_dropped() {
    let diagnostics = add_all(&[(user_diagnostic(WARNING, at(RUNTIME, 0)), "runs slowly")]);
    assert!(!diagnostics.has_errors());
    assert!(written(diagnostics).msgs.is_empty());
}

#[test]
fn module_beyond_program_counts_as_runtime() {
    assert!(written_record(WARNING, at(9, 0)).msgs.is_empty());
    let diagnostics = add_all(&[(user_diagnostic(ERROR, at(9, 0)), "cannot be compiled")]);
    assert!(diagnostics.has_internal_errors());
}

#[test]
fn empty_engine_text_uses_template_of_kind() {
    let log = written(add_all(&[(user_diagnostic(ERROR, NO_LOCATION), "")]));
    let expected = format!("TS{}: {}", ERROR.code(), ERROR.message());
    assert_eq!(kinds_and_texts(&log), [(Kind::Err, expected)]);
}

#[test]
fn equal_engine_records_print_once() {
    let record = user_diagnostic(WARNING, at(PROGRAM, 7));
    let log = written(add_all(&[(record, "runs slowly"), (record, "runs slowly")]));
    assert_eq!((log.msgs.len(), log.warnings), (1, 1));

    let elsewhere = user_diagnostic(WARNING, at(PROGRAM, 0));
    let log = written(add_all(&[
        (record, "runs slowly"),
        (elsewhere, "runs slowly"),
    ]));
    assert_eq!((log.msgs.len(), log.warnings), (2, 2));
}

#[test]
fn internal_error_names_kind_function_and_layout() {
    let record = internal_error(0, 0, NO_LOCATION);
    assert_eq!(
        internal_text(&record, "v3 is used in b1"),
        "UseNotDominated: v3 is used in b1 in function 'render' at /p/a.ts of layout 'Item'"
    );
}

#[test]
fn internal_error_prefers_position_to_module_of_function() {
    let record = internal_error(0, ABSENT_WORD, at(PROGRAM, 7));
    assert_eq!(
        internal_text(&record, "v3 is used in b1"),
        "UseNotDominated: v3 is used in b1 in function 'render' at /p/a.ts:2:1"
    );
}

#[test]
fn unnamed_function_and_layout_print_ids() {
    let record = internal_error(1, 1, NO_LOCATION);
    assert_eq!(
        internal_text(&record, "x"),
        "UseNotDominated: x in function f1 at /p/node_modules/b/b.js of layout L1"
    );
    let created_by_engine = internal_error(40, ABSENT_WORD, NO_LOCATION);
    assert_eq!(
        internal_text(&created_by_engine, "x"),
        "UseNotDominated: x in function f40"
    );
}

#[test]
fn internal_error_without_subject_has_kind_and_text() {
    let record = internal_error(ABSENT_WORD, ABSENT_WORD, NO_LOCATION);
    assert_eq!(internal_text(&record, "x"), "UseNotDominated: x");
    let template = InternalErrorKind::UseNotDominated.message();
    assert_eq!(
        internal_text(&record, ""),
        format!("UseNotDominated: {template}")
    );
}
