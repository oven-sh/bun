use bun_ast::Kind;
use bun_options_types::aot_options::AotOptions;
use bun_sema::check::aot::{Effect, FileOrigin, effect_of};
use bun_sema::messages::Category;
use bun_sema::program::FileId;

use super::super::{COMPILER_DIAGNOSTIC_CLASS, Diagnostic, Diagnostics, ProgramView, Span};
use super::{file_named, kinds_and_codes, kinds_and_texts, take_diagnostics, text, written};
use crate::compile::testing::{
    TYPED_PACKAGE_JSON, default_settings, with_loaded_build, with_loaded_build_and_options,
};
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
         import \"./plain.js\";\nimport \"dep\";\nimport \"untyped\";\nconsole.log([2, 1].sort());\n",
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
    (FileOrigin::TestedSource, Effect::StopsBuild, Effect::Warns),
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
    });
}

fn with_runtime_view<R>(then: impl FnOnce(ProgramView<'_, '_>) -> R) -> R {
    let files = [("main.ts", "console.log([2, 1].sort());\n")];
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
        let of_warning = report(Code::WorkerFileNotCompiled, b"./w.ts");
        shown.push((origin, of_error, of_warning));
    });
    let is_shown = |it: &(FileOrigin, Effect, Effect)| {
        !matches!(it.0, FileOrigin::TestedSource | FileOrigin::EvaluatedText)
    };
    let expected = COMPILER_DIAGNOSTIC_EFFECTS.into_iter().filter(is_shown);
    assert_eq!(shown, expected.collect::<Vec<_>>());
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
        let warning = Diagnostic::new(Code::WorkerFileNotCompiled, start_of(file), &[b"./w.ts"]);
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
fn nobody_looks_for_type_errors() {
    for text in [TYPE_ERROR, MISSING_DECLARATION, IMPLICIT_ANY] {
        assert_eq!(check(&[("main.ts", text)]), NOTHING, "{text}");
        assert_eq!(check_dependency_source(text), NOTHING, "{text}");
        assert_eq!(check_aot_source(text), NOTHING, "{text}");
    }
    let text = CHECKED_JAVASCRIPT_TYPE_ERROR;
    assert_eq!(check(&[("main.js", text)]), NOTHING);
    assert_eq!(check_dependency_javascript(text), NOTHING);
}

#[test]
fn type_errors_of_the_program_are_looked_for_on_request() {
    let check = |files: &[(&str, &str)]| {
        let options = AotOptions {
            looks_for_type_errors: true,
            ..AotOptions::default()
        };
        with_loaded_build_and_options(files, &default_settings(), options, |build, loaded| {
            let bound = build.bind_modules(loaded).expect("modules are bound");
            let _ = build.check_and_lower(loaded, &bound);
            kinds_and_codes(&written(take_diagnostics(build)))
        })
    };
    assert_eq!(check(&[("main.ts", TYPE_ERROR)]), [(Kind::Err, 2322)]);
    assert_eq!(
        check(&[("main.ts", MISSING_DECLARATION)]),
        [(Kind::Err, 2304)]
    );
    assert_eq!(check(&[("main.ts", IMPLICIT_ANY)]), [(Kind::Err, 7006)]);
    assert_eq!(
        check(&[("main.js", CHECKED_JAVASCRIPT_TYPE_ERROR)]),
        NOTHING
    );
    let dependency = [
        ("main.ts", "import \"dep\";\n"),
        ("node_modules/dep/package.json", TYPESCRIPT_PACKAGE),
        ("node_modules/dep/index.ts", TYPE_ERROR),
    ];
    assert_eq!(check(&dependency), NOTHING);
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
