use bun_ast::Kind;
use bun_sema::check::aot::{Effect, FileOrigin, effect_of};
use bun_sema::messages::Category;
use bun_sema::program::FileId;

use super::super::{COMPILER_DIAGNOSTIC_CLASS, Diagnostic, Diagnostics, ProgramView, Span};
use super::{file_named, kinds_and_codes, kinds_and_texts, take_diagnostics, text, written};
use crate::compile::testing::{TYPED_PACKAGE_JSON, default_settings, with_loaded_build};
use crate::diagnostic_codes::Code;
use crate::load::ProjectId;

const TYPESCRIPT_PACKAGE: &str = r#"{"name":"dep","version":"1.0.0","main":"index.ts"}"#;
const JAVASCRIPT_PACKAGE: &str = r#"{"name":"dep","version":"1.0.0","main":"index.js"}"#;

const TYPE_ERROR: &str = "export const x: number = \"a\";\n";
const CHECKED_JAVASCRIPT_TYPE_ERROR: &str =
    "// @ts-check\n/** @type {number} */\nexport const x = \"a\";\n";
const MISSING_DECLARATION: &str = "export const x = missing;\n";
const IMPLICIT_ANY: &str = "export function f(a) {\n  return a;\n}\n";
const DUPLICATE_LABEL: &str = "again: {\n  again: {}\n}\n";
const NOTHING: [(Kind, u32); 0] = [];
const CHECKS_DECLARATION_FILES: &str = concat!(
    r#"{"compilerOptions":{"lib":["ESNext"],"target":"ESNext","module":"Preserve","#,
    r#""moduleDetection":"force","moduleResolution":"bundler","noEmit":true,"strict":true,"#,
    r#""skipLibCheck":false,"skipDefaultLibCheck":true}}"#,
);

const EVERY_ORIGIN: [(&str, &str); 7] = [
    (
        "main.ts",
        "/// <reference path=\"./globals.d.ts\" />\n\
         import \"./plain.js\";\nimport \"dep\";\nimport \"untyped\";\n\
         Function(\"return 1\");\n",
    ),
    ("plain.js", "export {};\n"),
    ("globals.d.ts", "declare const declared: number;\n"),
    ("node_modules/dep/package.json", TYPESCRIPT_PACKAGE),
    ("node_modules/dep/index.ts", "export {};\n"),
    (
        "node_modules/untyped/package.json",
        r#"{"name":"untyped","version":"1.0.0","main":"index.js"}"#,
    ),
    ("node_modules/untyped/index.js", "module.exports = 1;\n"),
];

const APPLICATION_FILES: [(FileOrigin, &str); 5] = [
    (FileOrigin::ProgramSource, "/project/main.ts"),
    (FileOrigin::ProgramJavaScript, "/project/plain.js"),
    (
        FileOrigin::DependencySource,
        "/project/node_modules/dep/index.ts",
    ),
    (
        FileOrigin::DependencyJavaScript,
        "/project/node_modules/untyped/index.js",
    ),
    (FileOrigin::Declarations, "/project/globals.d.ts"),
];

const COMPILER_DIAGNOSTIC_EFFECTS: [(FileOrigin, Effect, Effect); FileOrigin::COUNT] = [
    (FileOrigin::NoFile, Effect::StopsBuild, Effect::Warns),
    (FileOrigin::ProgramSource, Effect::StopsBuild, Effect::Warns),
    (
        FileOrigin::ProgramJavaScript,
        Effect::StopsBuild,
        Effect::Warns,
    ),
    (
        FileOrigin::DependencySource,
        Effect::StopsBuild,
        Effect::Warns,
    ),
    (
        FileOrigin::DependencyJavaScript,
        Effect::StopsBuild,
        Effect::Warns,
    ),
    (FileOrigin::Declarations, Effect::StopsBuild, Effect::Warns),
    (FileOrigin::Runtime, Effect::InternalError, Effect::Dropped),
    (
        FileOrigin::EvaluatedText,
        Effect::WithdrawsTrust,
        Effect::Dropped,
    ),
];

fn start_of(file: FileId) -> Option<Span> {
    Some(Span {
        file,
        start: 0,
        end: 0,
    })
}

fn for_each_origin(mut visit: impl FnMut(FileOrigin, Option<ProgramView<'_, '_>>, Option<Span>)) {
    with_loaded_build(&EVERY_ORIGIN, &default_settings(), |_, loaded| {
        visit(FileOrigin::NoFile, None, None);
        let application = loaded.project(ProjectId::Application).view();
        for (origin, path) in APPLICATION_FILES {
            let file = file_named(application, path);
            assert_eq!(application.origin(file), origin, "{path}");
            visit(origin, Some(application), start_of(file));
        }
        let runtime = loaded.project(ProjectId::Runtime).view();
        let file = runtime.files().compiled_files()[0];
        assert_eq!(runtime.origin(file), FileOrigin::Runtime);
        visit(FileOrigin::Runtime, Some(runtime), start_of(file));
        let mut compiled_files = application.files().compiled_files().iter().copied();
        let is_text = |file: &FileId| application.origin(*file) == FileOrigin::EvaluatedText;
        let text = compiled_files.find(is_text);
        let text = text.expect("the text given to Function is a file");
        visit(FileOrigin::EvaluatedText, Some(application), start_of(text));
    });
}

fn with_runtime_view<R>(then: impl FnOnce(ProgramView<'_, '_>) -> R) -> R {
    let files = [("main.ts", "export {};\n")];
    with_loaded_build(&files, &default_settings(), |_, loaded| {
        then(loaded.project(ProjectId::Runtime).view())
    })
}

fn shown_effect(diagnostics: Diagnostics) -> Effect {
    let has_errors = diagnostics.has_errors();
    let has_internal_errors = diagnostics.has_internal_errors();
    let log = written(diagnostics);
    let kinds: Vec<Kind> = log.msgs.iter().map(|message| message.kind).collect();
    match (&kinds[..], has_errors, has_internal_errors) {
        ([], false, false) => Effect::Dropped,
        ([Kind::Warn], false, false) => Effect::Warns,
        ([Kind::Err], true, false) => Effect::StopsBuild,
        ([Kind::Err], true, true) => Effect::InternalError,
        unexpected => panic!("{unexpected:?}"),
    }
}

fn check(files: &[(&str, &str)]) -> Vec<(Kind, u32)> {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let bound = build.bind_modules(loaded).expect("modules are bound");
        let _ = build.check_and_lower(loaded, &bound);
        kinds_and_codes(&written(take_diagnostics(build)))
    })
}

fn check_dependency(manifest: &str, file: &str, text: &str) -> Vec<(Kind, u32)> {
    check(&[
        ("main.ts", "import \"dep\";\n"),
        ("node_modules/dep/package.json", manifest),
        (file, text),
    ])
}

fn check_dependency_source(text: &str) -> Vec<(Kind, u32)> {
    check_dependency(TYPESCRIPT_PACKAGE, "node_modules/dep/index.ts", text)
}

fn check_dependency_javascript(text: &str) -> Vec<(Kind, u32)> {
    check_dependency(JAVASCRIPT_PACKAGE, "node_modules/dep/index.js", text)
}

fn check_aot_source(typed: &str) -> Vec<(Kind, u32)> {
    check(&[
        ("main.ts", "import \"p\";\n"),
        ("node_modules/p/package.json", TYPED_PACKAGE_JSON),
        ("node_modules/p/x.js", "export {};\n"),
        ("node_modules/p/x.aot.ts", typed),
    ])
}

#[test]
fn compiler_diagnostics_have_effects_of_early_errors() {
    let origins = COMPILER_DIAGNOSTIC_EFFECTS.map(|(origin, ..)| origin);
    assert_eq!(origins, FileOrigin::ALL);
    for (origin, of_error, of_warning) in COMPILER_DIAGNOSTIC_EFFECTS {
        let effect = |category| effect_of(origin, COMPILER_DIAGNOSTIC_CLASS, category);
        assert_eq!(effect(Category::Error), of_error, "{origin:?}");
        assert_eq!(effect(Category::Warning), of_warning, "{origin:?}");
    }
}

#[test]
fn compiler_diagnostic_follows_origin() {
    let mut shown = Vec::new();
    for_each_origin(|origin, view, span| {
        let report = |code, argument: &[u8]| {
            let mut diagnostics = Diagnostics::new();
            diagnostics.add(view, Diagnostic::new(code, span, &[argument]));
            shown_effect(diagnostics)
        };
        let of_error = report(Code::NestedTooDeeply, b"500");
        let of_warning = report(Code::FunctionIntrospection, b"f.caller");
        shown.push((origin, of_error, of_warning));
    });
    let expected = COMPILER_DIAGNOSTIC_EFFECTS.map(|(origin, of_error, of_warning)| {
        let shown_for_error = match of_error {
            Effect::WithdrawsTrust => Effect::StopsBuild,
            Effect::StopsBuild | Effect::Warns | Effect::Dropped | Effect::InternalError => {
                of_error
            }
        };
        (origin, shown_for_error, of_warning)
    });
    assert_eq!(shown, expected);
}

#[test]
fn diagnostic_without_span_has_no_file() {
    with_runtime_view(|view| {
        let mut diagnostics = Diagnostics::new();
        diagnostics.add(Some(view), Diagnostic::new(Code::MacrosDisabled, None, &[]));
        assert_eq!(shown_effect(diagnostics), Effect::StopsBuild);
    });
}

#[test]
fn diagnostics_in_runtime_files_are_not_shown_to_users() {
    with_runtime_view(|view| {
        let file = view.files().compiled_files()[0];

        let mut diagnostics = Diagnostics::new();
        let warning = Diagnostic::new(Code::FunctionIntrospection, start_of(file), &[b"f.caller"]);
        diagnostics.add(Some(view), warning);
        assert!(!diagnostics.has_errors());
        assert!(written(diagnostics).msgs.is_empty());

        let mut diagnostics = Diagnostics::new();
        let error = Diagnostic::new(Code::NestedTooDeeply, start_of(file), &[b"500"]);
        diagnostics.add(Some(view), error);
        assert!(diagnostics.has_internal_errors());
        let path = text(view.sources.module_paths(file).display_path);
        let internal = format!(
            "internal compiler error (Lower): \
             TS100301: This code is nested more than 500 levels deep. at {path}:1:1"
        );
        assert_eq!(
            kinds_and_texts(&written(diagnostics)),
            [(Kind::Err, internal)]
        );
    });
}

#[test]
fn internal_error_quotes_at_most_eighty_bytes_of_source() {
    with_runtime_view(|view| {
        let files = view.files();
        let compiled_files = files.compiled_files().iter().copied();
        let file = compiled_files.max_by_key(|&file| files.hir(file).text.len());
        let file = file.expect("Bun has modules of its own");
        let quote = |end| {
            let span = Span {
                file,
                start: 0,
                end,
            };
            let mut diagnostics = Diagnostics::new();
            let error = Diagnostic::new(Code::NestedTooDeeply, Some(span), &[b"500"]);
            diagnostics.add(Some(view), error);
            kinds_and_texts(&written(diagnostics)).swap_remove(0).1
        };
        let source = |length: usize| format!(":1:1: {}", text(&files.hir(file).text[..length]));
        assert!(quote(10).ends_with(&source(10)));
        assert!(quote(80).ends_with(&source(80)));
        assert!(quote(200).ends_with(&source(80)));
    });
}

#[test]
fn type_error_in_program_source_stops_build() {
    assert_eq!(check(&[("main.ts", TYPE_ERROR)]), [(Kind::Err, 2322)]);
}

#[test]
fn signatures_of_compiler_declarations_take_no_parameter_types_away() {
    let source =
        "export const parse: typeof JSON.parse = (text, reviver) => JSON.parse(text, reviver);\n";
    assert_eq!(check(&[("main.ts", source)]), NOTHING);
}

#[test]
fn overloads_of_program_give_no_parameter_types() {
    let source = "interface Overloaded {
  <T>(value: T): T;
  (value: string): string;
}
export const same: Overloaded = value => value;
";
    assert_eq!(check(&[("main.ts", source)]), [(Kind::Err, 7006)]);
}

#[test]
fn type_error_in_program_javascript_is_dropped() {
    assert_eq!(
        check(&[("main.js", CHECKED_JAVASCRIPT_TYPE_ERROR)]),
        NOTHING
    );
}

#[test]
fn type_error_in_dependency_source_withdraws_trust() {
    assert_eq!(check_dependency_source(TYPE_ERROR), [(Kind::Warn, 100009)]);
}

#[test]
fn type_error_in_dependency_javascript_is_dropped() {
    assert_eq!(
        check_dependency_javascript(CHECKED_JAVASCRIPT_TYPE_ERROR),
        NOTHING
    );
}

#[test]
fn type_error_in_aot_source_withdraws_trust() {
    assert_eq!(check_aot_source(TYPE_ERROR), [(Kind::Warn, 100009)]);
}

#[test]
fn early_error_stops_build_in_every_compiled_file() {
    let stops_build = [(Kind::Err, 1114)];
    assert_eq!(check(&[("main.ts", DUPLICATE_LABEL)]), stops_build);
    assert_eq!(check(&[("main.js", DUPLICATE_LABEL)]), stops_build);
    assert_eq!(check_dependency_source(DUPLICATE_LABEL), stops_build);
    assert_eq!(check_dependency_javascript(DUPLICATE_LABEL), stops_build);
}

#[test]
fn missing_declaration_stops_build_only_in_program_source() {
    assert_eq!(
        check(&[("main.ts", MISSING_DECLARATION)]),
        [(Kind::Err, 2304)]
    );
    assert_eq!(check_dependency_source(MISSING_DECLARATION), NOTHING);
}

#[test]
fn style_error_stops_build_only_in_program_source() {
    assert_eq!(check(&[("main.ts", IMPLICIT_ANY)]), [(Kind::Err, 7006)]);
    assert_eq!(check_dependency_source(IMPLICIT_ANY), NOTHING);
    assert_eq!(check_aot_source(IMPLICIT_ANY), NOTHING);
}

#[test]
fn errors_in_declaration_files_are_dropped() {
    let shown = check(&[
        (
            "main.ts",
            "/// <reference path=\"./globals.d.ts\" />\nexport {};\n",
        ),
        ("globals.d.ts", "declare const declared: Missing;\n"),
        ("tsconfig.json", CHECKS_DECLARATION_FILES),
    ]);
    assert_eq!(shown, NOTHING);
}

#[test]
fn program_without_errors_shows_nothing() {
    assert_eq!(
        check(&[("main.ts", "export const x: number = 1;\n")]),
        NOTHING
    );
}
