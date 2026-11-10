use bun_ast::{Kind, Log};

use super::super::Diagnostics;
use super::super::engine_records::{internal_error_text, package_with_slow_code};
use super::{describe, kinds_and_texts, text, written};
use crate::diagnostic_codes::Code;
use crate::engine::{
    InternalErrorRecord, SourceLocation, TextRange, UserDiagnosticRecord, Witness,
};
use crate::ir::generated::{
    DiagnosticSeverity, InternalErrorKind, LimitId, TypeSiteKind, UserDiagnosticKind,
};
use crate::ir::ids::ABSENT_WORD;
use crate::report::{ModuleLocator, ModuleOrigin, ModuleSource, SourceTexts};

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

fn source(path: &str, text: &str, origin: ModuleOrigin) -> Option<ModuleSource> {
    Some(ModuleSource::new(path.as_bytes(), text.as_bytes()).with_origin(origin))
}

fn texts() -> SourceTexts {
    SourceTexts::new(vec![
        source("/p/a.ts", "first;\nsecond;\n", ModuleOrigin::Program),
        source(
            "/p/node_modules/b/b.js",
            "dependency;\n",
            ModuleOrigin::Dependency,
        ),
        source("node:http", "runtime;\n", ModuleOrigin::Runtime),
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

fn internal_error(location: SourceLocation) -> InternalErrorRecord {
    InternalErrorRecord {
        kind: InternalErrorKind::UseNotDominated,
        function: ABSENT_WORD,
        block: ABSENT_WORD,
        value: ABSENT_WORD,
        layout: ABSENT_WORD,
        limit: LimitId::None,
        count: 0,
        location,
        message: NO_TEXT,
    }
}

fn witness(location: SourceLocation) -> Witness {
    Witness {
        function: ABSENT_WORD,
        value: ABSENT_WORD,
        location,
    }
}

fn add_all_in(texts: &SourceTexts, records: &[(UserDiagnosticRecord, &str)]) -> Diagnostics {
    let mut locator = ModuleLocator::new(texts);
    let mut diagnostics = Diagnostics::new();
    for (record, text) in records {
        diagnostics.add_user_diagnostic(record, text.as_bytes(), texts, &mut locator);
    }
    diagnostics
}

fn add_all(records: &[(UserDiagnosticRecord, &str)]) -> Diagnostics {
    add_all_in(&texts(), records)
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
        &mut locator,
    ))
}

fn add_at_witness(code: Code, arguments: &[&[u8]], location: SourceLocation) -> Diagnostics {
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_at_witness(code, arguments, &witness(location), &texts());
    diagnostics
}

fn sentence_of(code: Code, arguments: &[&[u8]]) -> String {
    format!("TS{}: {}", code.number(), text(&code.message(arguments)))
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
fn slow_code_is_counted_only_in_packages() {
    let slow = UserDiagnosticKind::RegExpPatternNotConstant;
    let texts = texts();
    let package_of = |kind, location| {
        let record = user_diagnostic(kind, location);
        package_with_slow_code(&record, &texts).map(<[u8]>::to_vec)
    };
    assert_eq!(package_of(slow, at(DEPENDENCY, 0)), Some(b"b".to_vec()));
    assert_eq!(package_of(slow, at(PROGRAM, 0)), None);
    assert_eq!(package_of(slow, at(RUNTIME, 0)), None);
    assert_eq!(package_of(slow, NO_LOCATION), None);
    assert_eq!(package_of(WARNING, at(DEPENDENCY, 0)), None);
    assert_eq!(package_of(ERROR, at(DEPENDENCY, 0)), None);
}

#[test]
fn package_is_named_by_its_innermost_folder() {
    let package_at = |path: &str| {
        let texts = SourceTexts::new(vec![source(path, "x;\n", ModuleOrigin::Dependency)]);
        let record = user_diagnostic(UserDiagnosticKind::RegExpPatternNotConstant, at(0, 0));
        package_with_slow_code(&record, &texts)
            .map(|name| String::from_utf8_lossy(name).into_owned())
    };
    assert_eq!(package_at("node_modules/b/b.js").as_deref(), Some("b"));
    assert_eq!(
        package_at("/p/node_modules/@scope/name/dist/x.js").as_deref(),
        Some("@scope/name")
    );
    assert_eq!(
        package_at("/p/node_modules/a/node_modules/b/i.js").as_deref(),
        Some("b")
    );
    assert_eq!(package_at("/p/packages/linked/i.js"), None);
    assert_eq!(package_at("/p/node_modules/file.js"), None);
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
fn origin_of_source_decides_whose_error_it_is() {
    let texts = SourceTexts::new(vec![
        source("/p/a.ts", "a;\n", ModuleOrigin::Runtime),
        source("/p/b.ts", "b;\n", ModuleOrigin::Program),
    ]);
    let diagnostics = add_all_in(
        &texts,
        &[
            (user_diagnostic(ERROR, at(0, 0)), "cannot be compiled"),
            (user_diagnostic(ERROR, at(1, 0)), "cannot be compiled"),
        ],
    );
    let (number, stage) = (ERROR.code(), ERROR.stage().name());
    assert_eq!(
        describe(&written(diagnostics)),
        [
            format!("/p/b.ts:1:1 Err TS{number}: cannot be compiled"),
            format!("Err internal compiler error ({stage}): cannot be compiled at /p/a.ts"),
        ]
    );
}

#[test]
fn module_without_source_counts_as_runtime() {
    let texts = SourceTexts::new(vec![None]);
    let warning = user_diagnostic(WARNING, at(0, 3));
    assert!(
        written(add_all_in(&texts, &[(warning, "x")]))
            .msgs
            .is_empty()
    );
    let error = user_diagnostic(ERROR, at(0, 3));
    let stage = ERROR.stage().name();
    assert_eq!(
        kinds_and_texts(&written(add_all_in(&texts, &[(error, "x")]))),
        [(Kind::Err, format!("internal compiler error ({stage}): x"))]
    );
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
fn internal_error_has_kind_text_and_position() {
    let record = internal_error(at(PROGRAM, 7));
    assert_eq!(
        internal_text(&record, "v3 is used in b1"),
        "UseNotDominated: v3 is used in b1 at /p/a.ts:2:1"
    );
}

#[test]
fn internal_error_without_location_has_kind_and_text() {
    let record = internal_error(NO_LOCATION);
    assert_eq!(internal_text(&record, "x"), "UseNotDominated: x");
    let template = InternalErrorKind::UseNotDominated.message();
    assert_eq!(
        internal_text(&record, ""),
        format!("UseNotDominated: {template}")
    );
}

#[test]
fn warning_at_witness_prints_number_arguments_and_compiled_line() {
    let code = Code::WorkerFileNotCompiled;
    let arguments: &[&[u8]] = &[b"./worker.ts"];
    let diagnostics = add_at_witness(code, arguments, at(PROGRAM, 7));
    assert!(!diagnostics.has_errors());
    let log = written(diagnostics);
    let sentence = sentence_of(code, arguments);
    assert!(sentence.contains("./worker.ts"));
    assert_eq!(describe(&log), [format!("/p/a.ts:2:1 Warn {sentence}")]);
    let location = log.msgs[0].data.location.as_ref().expect("a location");
    assert_eq!(location.line_text.as_deref(), Some(&b"second;"[..]));
    assert_eq!((log.errors, log.warnings), (0, 1));
}

#[test]
fn warning_at_witness_without_location_has_none() {
    let code = Code::WorkerStartedFromUnknownValue;
    let diagnostics = add_at_witness(code, &[], NO_LOCATION);
    assert!(!diagnostics.has_errors());
    let log = written(diagnostics);
    assert_eq!(
        kinds_and_texts(&log),
        [(Kind::Warn, sentence_of(code, &[]))]
    );
    assert!(log.msgs[0].data.location.is_none());
}

#[test]
fn warning_at_witness_in_runtime_module_is_printed() {
    let code = Code::WorkerStartedFromUnknownValue;
    let diagnostics = add_at_witness(code, &[], at(RUNTIME, 0));
    assert!(!diagnostics.has_errors());
    let log = written(diagnostics);
    assert_eq!(
        kinds_and_texts(&log),
        [(Kind::Warn, sentence_of(code, &[]))]
    );
    let location = log.msgs[0].data.location.as_ref().expect("a location");
    assert_eq!(location.line_text.as_deref(), Some(&b"runtime;"[..]));
}

#[test]
fn warning_at_witness_in_module_without_source_has_no_location() {
    let code = Code::WorkerStartedFromUnknownValue;
    let log = written(add_at_witness(code, &[], at(9, 0)));
    assert_eq!(
        kinds_and_texts(&log),
        [(Kind::Warn, sentence_of(code, &[]))]
    );
    assert!(log.msgs[0].data.location.is_none());
}

#[test]
fn worker_start_of_no_place_warns_nobody() {
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_worker_start_without_name(&witness(NO_LOCATION), &texts());
    assert!(written(diagnostics).msgs.is_empty());
}

#[test]
fn worker_start_at_place_warns_there() {
    let seen = Witness {
        function: 0,
        ..witness(at(PROGRAM, 7))
    };
    let mut diagnostics = Diagnostics::new();
    diagnostics.add_worker_start_without_name(&seen, &texts());
    let sentence = sentence_of(Code::WorkerStartedFromUnknownValue, &[]);
    assert_eq!(
        describe(&written(diagnostics)),
        [format!("/p/a.ts:2:1 Warn {sentence}")]
    );
}

#[test]
fn error_at_witness_stops_build() {
    let location = at(DEPENDENCY, 0);
    let diagnostics = add_at_witness(Code::UnsupportedOption, &[b"--splitting"], location);
    assert!(diagnostics.has_errors());
    assert!(!diagnostics.has_internal_errors());
    assert_eq!(
        describe(&written(diagnostics)),
        ["/p/node_modules/b/b.js:1:1 Err TS100050: --aot does not support --splitting"]
    );
}
