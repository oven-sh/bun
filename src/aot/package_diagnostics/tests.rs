use super::*;
use crate::compile::testing::{default_settings, with_loaded_build};
use crate::diagnostics::new_driver_diagnostic;
use crate::load::ProjectId;
use bstr::BStr;
use bun_ast::{Data, Kind, Log};
use bun_sema::check::aot::DiagnosticClass;
use bun_sema::messages::Category;
use bun_sema::program::FileRole;
use bun_sema_driver::{Demotion, DemotionCause};

const DEPENDENCIES: &[(&str, &str)] = &[
    ("app.ts", "import \"dep\";\nimport \"helper\";\n"),
    (
        "node_modules/dep/package.json",
        r#"{"name":"dep","version":"1.0.0","main":"index.ts"}"#,
    ),
    (
        "node_modules/dep/index.ts",
        "import \"./other.ts\";\nimport \"./third.ts\";\n",
    ),
    ("node_modules/dep/other.ts", "export {};\n"),
    ("node_modules/dep/third.ts", "export {};\n"),
    (
        "node_modules/helper/package.json",
        r#"{"name":"helper","version":"2.0.0","main":"index.ts"}"#,
    ),
    ("node_modules/helper/index.ts", "export {};\n"),
];

const TWO_COPIES_OF_SHAPES: &[(&str, &str)] = &[
    ("app.ts", "import \"shapes\";\nimport \"dep\";\n"),
    (
        "node_modules/shapes/package.json",
        r#"{"name":"shapes","version":"1.2.3","main":"index.ts"}"#,
    ),
    ("node_modules/shapes/index.ts", "export {};\n"),
];

const NESTED_SHAPES: &[(&str, &str)] = &[
    (
        "node_modules/dep/package.json",
        r#"{"name":"dep","version":"1.0.0","main":"index.ts"}"#,
    ),
    ("node_modules/dep/index.ts", "import \"shapes\";\n"),
    (
        "node_modules/dep/node_modules/shapes/package.json",
        r#"{"name":"shapes","version":"2.0.0","main":"index.ts"}"#,
    ),
    (
        "node_modules/dep/node_modules/shapes/index.ts",
        "export {};\n",
    ),
];

const TYPE_ERROR: &str = "TS2322: Type 'string' is not assignable to type 'number'.";

#[derive(Debug, PartialEq, Eq)]
struct Printed {
    kind: Kind,
    text: String,
    position: Option<String>,
    notes: Vec<String>,
}

struct Outcome {
    printed: Vec<Printed>,
    stops_build: bool,
    remaining: Vec<BuildDiagnostic>,
}

fn message(kind: Kind, text: &str) -> Printed {
    Printed {
        kind,
        text: text.to_owned(),
        position: None,
        notes: Vec::new(),
    }
}

fn message_with_type_error(kind: Kind, text: &str) -> Printed {
    Printed {
        notes: vec![TYPE_ERROR.to_owned()],
        ..message(kind, text)
    }
}

fn package_warning(name: &str, errors: &str, first: &str, files: (u32, u32)) -> Printed {
    let (demoted, compiled) = files;
    let text = format!(
        "TS100009: '{name}' has {errors} (the first at {first}), so {demoted} of its {compiled} \
         files are compiled without their types. They still work, but run slower."
    );
    message_with_type_error(Kind::Warn, &text)
}

fn text_of(data: &Data) -> String {
    BStr::new(&data.text).to_string()
}

fn position_of(data: &Data) -> Option<String> {
    let location = data.location.as_ref()?;
    let file = BStr::new(&location.file);
    Some(format!("{file}:{}:{}", location.line, location.column))
}

fn print(diagnostics: Diagnostics) -> Vec<Printed> {
    let mut log = Log::init();
    diagnostics.write_to(&mut log);
    let messages = log.msgs.iter();
    messages
        .map(|message| Printed {
            kind: message.kind,
            text: text_of(&message.data),
            position: position_of(&message.data),
            notes: message.notes.iter().map(text_of).collect(),
        })
        .collect()
}

fn with_packages<R>(files: &[(&str, &str)], then: impl FnOnce(ProgramView<'_, '_>) -> R) -> R {
    with_loaded_build(files, &default_settings(), |_, loaded| {
        then(loaded.project(ProjectId::Application).view())
    })
}

fn file_at(packages: ProgramView<'_, '_>, suffix: &str) -> FileId {
    let files = packages.files();
    let mut compiled_files = files.compiled_files().iter().copied();
    compiled_files
        .find(|&file| files.module(file).file_name().ends_with(suffix.as_bytes()))
        .unwrap_or_else(|| panic!("{suffix} is not compiled"))
}

fn type_error(packages: ProgramView<'_, '_>, file: FileId, effect: Effect) -> BuildDiagnostic {
    let text = b"Type 'string' is not assignable to type 'number'.".to_vec();
    let diagnostic = driver::Diagnostic {
        path: packages.files().module(file).file_name().to_vec(),
        start: 6,
        end: 7,
        has_undefined_range: false,
        line: 1,
        column: 7,
        end_line: 1,
        end_column: 8,
        class: DiagnosticClass::Semantic,
        file: Some(file),
        ..new_driver_diagnostic(2322, Category::Error, text, &[])
    };
    BuildDiagnostic { diagnostic, effect }
}

fn withdraws_trust(packages: ProgramView<'_, '_>, file: FileId) -> BuildDiagnostic {
    type_error(packages, file, Effect::WithdrawsTrust)
}

fn with_type_errors(files: &[FileId]) -> Vec<Demotion> {
    let cause = DemotionCause::TypeError;
    files.iter().map(|&file| Demotion { file, cause }).collect()
}

fn role_decision(packages: ProgramView<'_, '_>, demoted: &[Demotion]) -> RoleDecision {
    let files = packages.files();
    let file_ids = (0..files.modules.len()).map(|index| FileId(index as u32));
    let mut roles: Vec<FileRole> = file_ids.map(|file| files.role(file)).collect();
    let mut demoted = demoted.to_vec();
    demoted.sort_unstable_by_key(|demotion| demotion.file);
    for demotion in &demoted {
        roles[demotion.file.idx()] = FileRole::Inferred;
    }
    RoleDecision {
        roles,
        demoted,
        checked: Vec::new(),
        diagnostics: Vec::new(),
        incomplete: Vec::new(),
    }
}

fn report(
    packages: ProgramView<'_, '_>,
    checked: Vec<BuildDiagnostic>,
    demoted: &[Demotion],
) -> Outcome {
    let roles = role_decision(packages, demoted);
    let mut diagnostics = Diagnostics::new();
    let errors = report_package_errors(&mut diagnostics, packages, checked, &roles);
    Outcome {
        stops_build: diagnostics.has_errors(),
        printed: print(diagnostics),
        remaining: errors.remaining,
    }
}

fn report_without_errors(packages: ProgramView<'_, '_>) -> Outcome {
    report(packages, Vec::new(), &[])
}

fn remaining_files(outcome: &Outcome) -> Vec<Option<FileId>> {
    let remaining = outcome.remaining.iter();
    remaining.map(|reported| reported.diagnostic.file).collect()
}

#[test]
fn control_characters_are_replaced() {
    assert_eq!(printable(b"a\0b\x1fc\x7fd\n"), b"a?b?c?d?");
    assert_eq!(printable("\u{e9} ~".as_bytes()), "\u{e9} ~".as_bytes());
}

#[test]
fn demoted_package_gets_one_warning() {
    let outcome = with_packages(DEPENDENCIES, |packages| {
        let index = file_at(packages, "dep/index.ts");
        let other = file_at(packages, "dep/other.ts");
        let checked = vec![
            withdraws_trust(packages, index),
            withdraws_trust(packages, other),
        ];
        report(packages, checked, &with_type_errors(&[index, other]))
    });
    let first = "/project/node_modules/dep/index.ts:1:7";
    assert_eq!(
        outcome.printed,
        [package_warning("dep", "2 type errors", first, (2, 3))]
    );
    assert!(!outcome.stops_build);
    assert!(outcome.remaining.is_empty());
}

#[test]
fn single_error_is_singular() {
    let outcome = with_packages(DEPENDENCIES, |packages| {
        let other = file_at(packages, "dep/other.ts");
        let checked = vec![withdraws_trust(packages, other)];
        report(packages, checked, &with_type_errors(&[other]))
    });
    let first = "/project/node_modules/dep/other.ts:1:7";
    assert_eq!(
        outcome.printed,
        [package_warning("dep", "1 type error", first, (1, 3))]
    );
}

#[test]
fn several_errors_of_one_file_demote_one_file() {
    let outcome = with_packages(DEPENDENCIES, |packages| {
        let other = file_at(packages, "dep/other.ts");
        let checked = vec![
            withdraws_trust(packages, other),
            withdraws_trust(packages, other),
        ];
        report(packages, checked, &with_type_errors(&[other]))
    });
    let first = "/project/node_modules/dep/other.ts:1:7";
    assert_eq!(
        outcome.printed,
        [package_warning("dep", "2 type errors", first, (1, 3))]
    );
}

#[test]
fn demoted_file_outside_packages_is_named_by_path() {
    let outcome = with_packages(DEPENDENCIES, |packages| {
        let app = file_at(packages, "app.ts");
        let checked = vec![withdraws_trust(packages, app)];
        report(packages, checked, &with_type_errors(&[app]))
    });
    let text = "TS100010: '/project/app.ts' has 1 type error (the first at /project/app.ts:1:7), \
                so it is compiled without its types. It still works, but runs slower.";
    assert_eq!(outcome.printed, [message_with_type_error(Kind::Warn, text)]);
}

#[test]
fn each_demoted_package_is_counted_once() {
    let outcome = with_packages(DEPENDENCIES, |packages| {
        let demoted = ["app.ts", "dep/index.ts", "dep/other.ts", "helper/index.ts"]
            .map(|suffix| file_at(packages, suffix));
        let checked = demoted.map(|file| withdraws_trust(packages, file));
        report(packages, checked.into(), &with_type_errors(&demoted))
    });
    assert_eq!(outcome.printed.len(), 3);
    assert!(outcome.remaining.is_empty());
}

#[test]
fn build_stopping_error_stays_in_remaining() {
    let (outcome, expected) = with_packages(DEPENDENCIES, |packages| {
        let index = file_at(packages, "dep/index.ts");
        let other = file_at(packages, "dep/other.ts");
        let checked = vec![
            type_error(packages, other, Effect::StopsBuild),
            type_error(packages, index, Effect::StopsBuild),
        ];
        (report(packages, checked, &[]), [Some(other), Some(index)])
    });
    assert_eq!(remaining_files(&outcome), expected);
    assert!(outcome.printed.is_empty());
}

#[test]
fn other_effects_stay_in_remaining() {
    let outcome = with_packages(DEPENDENCIES, |packages| {
        let index = file_at(packages, "dep/index.ts");
        let mut without_file = withdraws_trust(packages, index);
        without_file.diagnostic.file = None;
        let checked = vec![
            type_error(packages, index, Effect::Warns),
            type_error(packages, index, Effect::InternalError),
            without_file,
        ];
        report(packages, checked, &[])
    });
    let effects: Vec<Effect> = outcome.remaining.iter().map(|it| it.effect).collect();
    assert_eq!(
        effects,
        [Effect::Warns, Effect::InternalError, Effect::WithdrawsTrust]
    );
    assert!(outcome.printed.is_empty());
}

#[test]
fn copies_of_one_package_are_grouped_separately() {
    let files = [TWO_COPIES_OF_SHAPES, NESTED_SHAPES].concat();
    let outcome = with_packages(&files, |packages| {
        let demoted = [
            "project/node_modules/shapes/index.ts",
            "dep/node_modules/shapes/index.ts",
        ]
        .map(|suffix| file_at(packages, suffix));
        let checked = demoted.map(|file| withdraws_trust(packages, file));
        report(packages, checked.into(), &with_type_errors(&demoted))
    });
    let mut printed = outcome.printed.iter();
    assert!(printed.all(|it| it.text.starts_with("TS100009: 'shapes' has 1 type error ")));
    assert_eq!(outcome.printed.len(), 2);
}

#[test]
fn demoted_runtime_file_is_not_reported() {
    let files = [("app.js", "import \"node:path\";\n")];
    let outcome = with_loaded_build(&files, &default_settings(), |_, loaded| {
        let packages = loaded.project(ProjectId::Runtime).view();
        let file = packages.files().compiled_files()[0];
        assert_eq!(packages.origin(file), FileOrigin::Runtime);
        let checked = vec![withdraws_trust(packages, file)];
        report(packages, checked, &with_type_errors(&[file]))
    });
    assert!(outcome.printed.is_empty(), "{:?}", outcome.printed);
    assert!(outcome.remaining.is_empty());
}

#[test]
fn untyped_program_reports_nothing() {
    let outcome = with_packages(DEPENDENCIES, report_without_errors);
    assert!(outcome.printed.is_empty());
    assert!(outcome.remaining.is_empty());
}
