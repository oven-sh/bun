use super::*;
use crate::compile::testing::{
    TYPED_PACKAGE_JSON, TYPED_PACKAGE_SOUND_JSON, default_settings, describe_load,
    with_loaded_build, with_loaded_build_and_options,
};
use crate::diagnostics::new_driver_diagnostic;
use crate::load::ProjectId;
use bstr::BStr;
use bun_ast::{Data, Kind, Log};
use bun_options_types::aot_options::AotOptions;
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

const SHAPES: &[(&str, &str)] = &[
    ("app.ts", "import \"shapes\";\nimport \"shapes/more\";\n"),
    (
        "node_modules/shapes/package.json",
        concat!(
            r#"{"name":"shapes","version":"1.2.3","type":"module","exports":{"#,
            r#"".":{"full-types":"./index.full.ts","default":"./index.js"},"#,
            r#""./more":{"full-types":"./more.full.ts","default":"./more.js"}}}"#,
        ),
    ),
    (
        "node_modules/shapes/index.js",
        "export const area = 2 * 3;\n",
    ),
    (
        "node_modules/shapes/index.full.ts",
        "export const area: number = 2 * 3;\n",
    ),
    ("node_modules/shapes/more.js", "export const sides = 4;\n"),
    (
        "node_modules/shapes/more.full.ts",
        "export const sides: number = 4;\n",
    ),
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

const NESTED_COPY_OF_OTHER_VERSION: &[(&str, &str)] = &[
    (
        "node_modules/dep/package.json",
        r#"{"name":"dep","version":"1.0.0","main":"index.ts"}"#,
    ),
    ("node_modules/dep/index.ts", "import \"p\";\n"),
    (
        "node_modules/dep/node_modules/p/package.json",
        r#"{"name":"p","version":"2.0.0","type":"module","main":"x.js"}"#,
    ),
    (
        "node_modules/dep/node_modules/p/x.js",
        "export const x = 1;\n",
    ),
];

const TYPED_FILE: &str = "export const x: number = 1;\n";
const TYPED_FILE_WITH_OTHER_CODE: &str = "export const x: number = 2;\n";

const SOUND_JSON_FOR_OTHER_VERSION: &str =
    r#"{"sound":2,"name":"p","version":"2.0.0","when":{},"lay":{"x.js":""},"needs":[]}"#;

const SOUND_JSON_FOR_PRODUCTION: &str = concat!(
    r#"{"sound":2,"name":"p","version":"1.0.0","#,
    r#""when":{"process.env.NODE_ENV":"production"},"lay":{"x.js":""},"needs":[]}"#,
);

const CAST_BEFORE_MISMATCH: &str = concat!(
    "function read() {\n",
    "  return 1;\n",
    "}\n",
    "export const first = /** @type {number} */ (read());\n",
    "export const area = 2;\n",
);

const TYPED_CAST_BEFORE_MISMATCH: &str = concat!(
    "function read(): number {\n",
    "  return 1;\n",
    "}\n",
    "export const first: number = (read());\n",
    "export const area: number = 3;\n",
);

const SHAPES_USED: &str = "\"shapes\" 1.2.3 is compiled from its full types in node_modules/shapes";
const PROJECT_VERSION_USED: &str = "\"p\" 1.0.0 is compiled from its full types in .sound/p";
const IS_FOR_OTHER_VERSION: &str = "it is for version 2.0.0, but 1.0.0 is installed. \
                                    Replace it with the full types for 1.0.0, or remove it";
const NEEDS_PRODUCTION: &str = "it needs process.env.NODE_ENV to be defined as \"production\". \
                                Pass --define 'process.env.NODE_ENV=\"production\"'";
const SHIPPED_VERSION_DIFFERS: &str =
    "index.full.ts without its types doesn't match index.js. Was the package patched?";
const SHIPPED_VERSION_EMITS_CODE: &str =
    "in index.full.ts, TypeScript syntax that emits code can't be erased";
const TYPE_ERROR: &str = "TS2322: Type 'string' is not assignable to type 'number'.";

#[derive(Debug, PartialEq, Eq)]
struct Printed {
    kind: Kind,
    text: String,
    position: Option<String>,
    notes: Vec<String>,
}

struct Outcome {
    rejected_versions: Vec<Printed>,
    printed: Vec<Printed>,
    stops_build: bool,
    remaining: Vec<BuildDiagnostic>,
    demoted_directories: Vec<String>,
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

fn shipped_version_text(sentence: &str) -> String {
    format!(
        "\"shapes\" is compiled without types, because its full types in node_modules/shapes \
         can't be used: {sentence}"
    )
}

fn shipped_version_not_used(position: &str, sentence: &str) -> Printed {
    Printed {
        position: Some(position.to_owned()),
        ..message(Kind::Warn, &shipped_version_text(sentence))
    }
}

fn project_version_text(sentence: &str) -> String {
    format!("TS100056: The full types of \"p\" in .sound/p can't be used: {sentence}")
}

fn load_with_messages(lines: &[String]) -> String {
    format!("loaded: {}\n", lines.join("\n"))
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

fn with_packages<R>(files: &[(&str, &str)], then: impl FnOnce(PackageView<'_, '_>) -> R) -> R {
    with_loaded_build(files, &default_settings(), |_, loaded| {
        then(loaded.packages(ProjectId::Application))
    })
}

fn with_unreported_packages<R>(
    files: &[(&str, &str)],
    then: impl FnOnce(PackageView<'_, '_>) -> R,
) -> R {
    let aot = AotOptions {
        runs_in_place: true,
        ..AotOptions::default()
    };
    with_loaded_build_and_options(files, &default_settings(), aot, |_, loaded| {
        then(loaded.packages(ProjectId::Application))
    })
}

fn shipped_index_files<'a>(installed: &'a str, typed: &'a str) -> Vec<(&'a str, &'a str)> {
    let mut files: Vec<(&str, &str)> = SHAPES.to_vec();
    for (path, text) in &mut files {
        match *path {
            "node_modules/shapes/index.js" => *text = installed,
            "node_modules/shapes/index.full.ts" => *text = typed,
            _ => {}
        }
    }
    files
}

fn with_shipped_index<R>(
    installed: &str,
    typed: &str,
    then: impl FnOnce(PackageView<'_, '_>) -> R,
) -> R {
    with_packages(&shipped_index_files(installed, typed), then)
}

fn with_two_shapes_copies<R>(then: impl FnOnce(PackageView<'_, '_>) -> R) -> R {
    let app = ("app.ts", "import \"shapes\";\nimport \"dep\";\n");
    let files = [&[app][..], &SHAPES[1..], NESTED_SHAPES].concat();
    with_packages(&files, then)
}

fn with_project_version<R>(typed: &str, then: impl FnOnce(PackageView<'_, '_>) -> R) -> R {
    with_packages(
        &project_version_files(TYPED_PACKAGE_SOUND_JSON, typed),
        then,
    )
}

fn project_version_files<'a>(sound_json: &'a str, typed: &'a str) -> [(&'a str, &'a str); 5] {
    [
        ("app.ts", "import \"p\";\n"),
        ("node_modules/p/package.json", TYPED_PACKAGE_JSON),
        ("node_modules/p/x.js", "export const x = 1;\n"),
        (".sound/p/sound.json", sound_json),
        (".sound/p/lay/x.js", typed),
    ]
}

fn file_at(packages: PackageView<'_, '_>, suffix: &str) -> FileId {
    let files = packages.view.files();
    let mut compiled_files = files.compiled_files().iter().copied();
    compiled_files
        .find(|&file| files.module(file).file_name().ends_with(suffix.as_bytes()))
        .unwrap_or_else(|| panic!("{suffix} is not compiled"))
}

fn rejection_kind(packages: PackageView<'_, '_>, file: FileId) -> Option<ErasureMismatchKind> {
    let compiled = packages.view.files().compiled(file)?;
    Some(compiled.rejected_typed_version?.kind)
}

fn type_error(packages: PackageView<'_, '_>, file: FileId, effect: Effect) -> BuildDiagnostic {
    let text = b"Type 'string' is not assignable to type 'number'.".to_vec();
    let diagnostic = driver::Diagnostic {
        path: packages.view.files().diagnostic_path(file).to_vec(),
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

fn withdraws_trust(packages: PackageView<'_, '_>, file: FileId) -> BuildDiagnostic {
    type_error(packages, file, Effect::WithdrawsTrust)
}

fn with_type_errors(files: &[FileId]) -> Vec<Demotion> {
    let cause = DemotionCause::TypeError;
    files.iter().map(|&file| Demotion { file, cause }).collect()
}

fn role_decision(packages: PackageView<'_, '_>, demoted: &[Demotion]) -> RoleDecision {
    let files = packages.view.files();
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

fn print_rejected_versions(
    packages: PackageView<'_, '_>,
    defines: &[(&str, &str)],
) -> Vec<Printed> {
    let defined = |path: &[u8]| {
        let define = defines.iter().find(|define| define.0.as_bytes() == path)?;
        Some(define.1.as_bytes().to_vec())
    };
    let mut diagnostics = Diagnostics::new();
    report_rejected_versions(&mut diagnostics, packages, &defined);
    print(diagnostics)
}

fn report(
    packages: PackageView<'_, '_>,
    checked: Vec<BuildDiagnostic>,
    demoted: &[Demotion],
) -> Outcome {
    let roles = role_decision(packages, demoted);
    let mut diagnostics = Diagnostics::new();
    let errors = report_package_errors(&mut diagnostics, packages, checked, &roles);
    report_used_versions(&mut diagnostics, packages, &errors.demoted_directories);
    let demoted_directories = errors.demoted_directories.iter();
    Outcome {
        rejected_versions: print_rejected_versions(packages, &[]),
        stops_build: diagnostics.has_errors(),
        printed: print(diagnostics),
        remaining: errors.remaining,
        demoted_directories: demoted_directories
            .map(|directory| BStr::new(directory).to_string())
            .collect(),
    }
}

fn report_without_errors(packages: PackageView<'_, '_>) -> Outcome {
    report(packages, Vec::new(), &[])
}

fn remaining_files(outcome: &Outcome) -> Vec<Option<FileId>> {
    let remaining = outcome.remaining.iter();
    remaining.map(|reported| reported.diagnostic.file).collect()
}

#[test]
fn only_emitted_code_changes_rejected_version_sentence() {
    const AREA: &str = "export const area = 6;\n";
    let cases = [
        (
            ErasureMismatchKind::NodeKind,
            AREA,
            "export const area: string = \"6\";\n",
            SHIPPED_VERSION_DIFFERS,
        ),
        (
            ErasureMismatchKind::Name,
            AREA,
            "export const size: number = 6;\n",
            SHIPPED_VERSION_DIFFERS,
        ),
        (
            ErasureMismatchKind::Literal,
            AREA,
            "export const area: number = 7;\n",
            SHIPPED_VERSION_DIFFERS,
        ),
        (
            ErasureMismatchKind::Operator,
            "export const area = 2 * 3;\n",
            "export const area: number = 2 + 3;\n",
            SHIPPED_VERSION_DIFFERS,
        ),
        (
            ErasureMismatchKind::Flags,
            AREA,
            "export let area: number = 6;\n",
            SHIPPED_VERSION_DIFFERS,
        ),
        (
            ErasureMismatchKind::ChildCount,
            AREA,
            "export const area: number = 6;\nexport const sides: number = 4;\n",
            SHIPPED_VERSION_DIFFERS,
        ),
        (
            ErasureMismatchKind::EmitsCode,
            "var Kind;\nexport const area = 6;\n",
            "enum Kind { A }\nexport const area: number = 6;\n",
            SHIPPED_VERSION_EMITS_CODE,
        ),
    ];
    for (kind, installed, typed, sentence) in cases {
        let (found, outcome) = with_shipped_index(installed, typed, |packages| {
            let index = file_at(packages, "shapes/index.js");
            let found = rejection_kind(packages, index);
            (found, report_without_errors(packages))
        });
        assert_eq!(found, Some(kind), "{typed}");
        let texts: Vec<&str> = (outcome.rejected_versions.iter())
            .map(|rejected| rejected.text.as_str())
            .collect();
        assert_eq!(texts, [shipped_version_text(sentence)], "{typed}");
        assert!(outcome.printed.is_empty(), "{typed}");
    }
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
    assert_eq!(outcome.demoted_directories, ["/project/node_modules/dep"]);
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
fn neighbor_of_rejected_version_counts_as_demoted() {
    let outcome = with_packages(DEPENDENCIES, |packages| {
        let index = file_at(packages, "dep/index.ts");
        let neighbor = Demotion {
            file: file_at(packages, "dep/other.ts"),
            cause: DemotionCause::RejectedNeighbor,
        };
        let demoted = [with_type_errors(&[index]), vec![neighbor]].concat();
        report(packages, vec![withdraws_trust(packages, index)], &demoted)
    });
    let first = "/project/node_modules/dep/index.ts:1:7";
    assert_eq!(
        outcome.printed,
        [package_warning("dep", "1 type error", first, (2, 3))]
    );
}

#[test]
fn neighbor_without_errors_demotes_package_silently() {
    let outcome = with_packages(SHAPES, |packages| {
        let neighbor = Demotion {
            file: file_at(packages, "shapes/more.js"),
            cause: DemotionCause::RejectedNeighbor,
        };
        report(packages, Vec::new(), &[neighbor])
    });
    assert!(outcome.printed.is_empty(), "{:?}", outcome.printed);
    assert_eq!(
        outcome.demoted_directories,
        ["/project/node_modules/shapes"]
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
    assert!(outcome.demoted_directories.is_empty());
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
    assert_eq!(
        outcome.demoted_directories,
        ["/project/node_modules/dep", "/project/node_modules/helper"]
    );
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
    assert!(outcome.demoted_directories.is_empty());
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
    assert!(outcome.demoted_directories.is_empty());
}

#[test]
fn typed_version_error_stops_build() {
    let outcome = with_project_version(TYPED_FILE, |packages| {
        let x = file_at(packages, "p/x.js");
        let error = || type_error(packages, x, Effect::StopsBuild);
        report(packages, vec![error(), error()], &[])
    });
    let text = "TS100021: The full types of 'p' in .sound/p has type errors (2), \
                the first at /project/.sound/p/lay/x.js:1:7";
    let error = message_with_type_error(Kind::Err, text);
    assert_eq!(
        outcome.printed,
        [error, message(Kind::Note, PROJECT_VERSION_USED)]
    );
    assert!(outcome.stops_build);
    assert!(outcome.remaining.is_empty());
    assert!(outcome.demoted_directories.is_empty());
}

#[test]
fn typed_version_errors_need_project_origin() {
    let project_origin = with_project_version(TYPED_FILE, |packages| {
        packages.view.origin(file_at(packages, "p/x.js"))
    });
    assert_eq!(project_origin, FileOrigin::ProjectTypedVersion);

    let (origin, outcome, index) = with_packages(SHAPES, |packages| {
        let index = file_at(packages, "shapes/index.js");
        let checked = vec![type_error(packages, index, Effect::StopsBuild)];
        (
            packages.view.origin(index),
            report(packages, checked, &[]),
            index,
        )
    });
    assert_eq!(origin, FileOrigin::DependencySource);
    assert_eq!(remaining_files(&outcome), [Some(index)]);
    assert_eq!(outcome.printed, [message(Kind::Note, SHAPES_USED)]);
    assert!(!outcome.stops_build);
}

#[test]
fn demoted_typed_version_only_warns() {
    let outcome = with_packages(SHAPES, |packages| {
        let index = file_at(packages, "shapes/index.js");
        let checked = vec![withdraws_trust(packages, index)];
        report(packages, checked, &with_type_errors(&[index]))
    });
    let first = "/project/node_modules/shapes/index.full.ts:1:7";
    assert_eq!(
        outcome.printed,
        [package_warning("shapes", "1 type error", first, (1, 2))]
    );
    assert!(!outcome.stops_build);
    assert_eq!(
        outcome.demoted_directories,
        ["/project/node_modules/shapes"]
    );
}

#[test]
fn demotion_hides_no_note_of_other_packages() {
    let app = ("app.ts", "import \"shapes\";\nimport \"dep\";\n");
    let files = [&[app][..], &SHAPES[1..], &DEPENDENCIES[1..]].concat();
    let outcome = with_packages(&files, |packages| {
        let index = file_at(packages, "dep/index.ts");
        let checked = vec![withdraws_trust(packages, index)];
        report(packages, checked, &with_type_errors(&[index]))
    });
    assert_eq!(outcome.printed.len(), 2);
    assert!(outcome.printed.contains(&message(Kind::Note, SHAPES_USED)));
    assert_eq!(outcome.demoted_directories, ["/project/node_modules/dep"]);
}

#[test]
fn demoted_copy_hides_no_note_of_other_copy() {
    let outcome = with_two_shapes_copies(|packages| {
        let nested = file_at(packages, "dep/node_modules/shapes/index.ts");
        let checked = vec![withdraws_trust(packages, nested)];
        report(packages, checked, &with_type_errors(&[nested]))
    });
    let first = "/project/node_modules/dep/node_modules/shapes/index.ts:1:7";
    let warning = package_warning("shapes", "1 type error", first, (1, 1));
    assert_eq!(outcome.printed.len(), 2);
    assert!(outcome.printed.contains(&warning));
    assert!(outcome.printed.contains(&message(Kind::Note, SHAPES_USED)));
    assert_eq!(
        outcome.demoted_directories,
        ["/project/node_modules/dep/node_modules/shapes"]
    );
}

#[test]
fn copies_of_one_package_are_grouped_separately() {
    let outcome = with_two_shapes_copies(|packages| {
        let demoted =
            ["shapes/index.js", "shapes/index.ts"].map(|suffix| file_at(packages, suffix));
        let checked = demoted.map(|file| withdraws_trust(packages, file));
        report(packages, checked.into(), &with_type_errors(&demoted))
    });
    let mut printed = outcome.printed.iter();
    assert!(printed.all(|it| it.text.starts_with("TS100009: 'shapes' has 1 type error ")));
    assert_eq!(outcome.printed.len(), 2);
    assert_eq!(outcome.demoted_directories.len(), 2);
}

#[test]
fn typed_files_of_one_package_give_one_note() {
    let outcome = with_packages(SHAPES, report_without_errors);
    assert_eq!(outcome.printed, [message(Kind::Note, SHAPES_USED)]);
    assert!(outcome.rejected_versions.is_empty());
    assert!(!outcome.stops_build);
}

#[test]
fn rejected_shipped_version_warns_at_installed_file() {
    let outcome = with_shipped_index(
        "export const area = 2 * 3;\n",
        "export const area: number = 2 + 3;\n",
        report_without_errors,
    );
    let position = "/project/node_modules/shapes/index.js:1:21";
    let warning = shipped_version_not_used(position, SHIPPED_VERSION_DIFFERS);
    assert_eq!(outcome.rejected_versions, [warning]);
    assert!(outcome.printed.is_empty());
}

#[test]
fn jsdoc_cast_does_not_move_rejected_version_position() {
    let outcome = with_shipped_index(
        CAST_BEFORE_MISMATCH,
        TYPED_CAST_BEFORE_MISMATCH,
        report_without_errors,
    );
    let position = "/project/node_modules/shapes/index.js:5:21";
    let warning = shipped_version_not_used(position, SHIPPED_VERSION_DIFFERS);
    assert_eq!(outcome.rejected_versions, [warning]);
}

#[test]
fn accepted_project_version_is_named_by_sound_folder() {
    let outcome = with_project_version(TYPED_FILE, report_without_errors);
    assert_eq!(outcome.printed, [message(Kind::Note, PROJECT_VERSION_USED)]);
    assert!(outcome.rejected_versions.is_empty());
}

#[test]
fn rejected_project_version_is_reported_and_names_both_files() {
    let files = project_version_files(TYPED_PACKAGE_SOUND_JSON, TYPED_FILE_WITH_OTHER_CODE);
    let expected = "loaded: /project/node_modules/p/x.js:1:18: TS100056: The full types of \"p\" \
                    in .sound/p can't be used: lay/x.js without its types doesn't match x.js. \
                    Was the package patched?\n";
    assert_eq!(describe_load(&files), expected);
}

#[test]
fn manifest_mismatch_is_reported_without_position() {
    let files = project_version_files(SOUND_JSON_FOR_OTHER_VERSION, TYPED_FILE);
    let expected = load_with_messages(&[project_version_text(IS_FOR_OTHER_VERSION)]);
    assert_eq!(describe_load(&files), expected);
}

#[test]
fn manifest_without_pins_is_reported() {
    let files = project_version_files("{}", TYPED_FILE);
    let expected = load_with_messages(&[project_version_text("its sound.json is not valid")]);
    assert_eq!(describe_load(&files), expected);
}

#[test]
fn manifest_mismatch_hides_rejected_files_of_package() {
    let files = project_version_files(SOUND_JSON_FOR_OTHER_VERSION, TYPED_FILE_WITH_OTHER_CODE);
    let expected = load_with_messages(&[project_version_text(IS_FOR_OTHER_VERSION)]);
    assert_eq!(describe_load(&files), expected);
}

#[test]
fn manifest_mismatch_hides_no_rejected_file_of_other_packages() {
    let app = ("app.ts", "import \"p\";\nimport \"shapes\";\n");
    let shapes = shipped_index_files(
        "export const area = 2 * 3;\n",
        "export const area: number = 2 + 3;\n",
    );
    let project_version = project_version_files(SOUND_JSON_FOR_OTHER_VERSION, TYPED_FILE);
    let files = [&[app][..], &shapes[1..], &project_version[1..]].concat();
    let warning = shipped_version_text(SHIPPED_VERSION_DIFFERS);
    let expected = load_with_messages(&[
        project_version_text(IS_FOR_OTHER_VERSION),
        format!("/project/node_modules/shapes/index.js:1:21: {warning}"),
    ]);
    assert_eq!(describe_load(&files), expected);
}

#[test]
fn each_installed_copy_is_compared_with_manifest() {
    let app = ("app.ts", "import \"p\";\nimport \"dep\";\n");
    let project_version = project_version_files(TYPED_PACKAGE_SOUND_JSON, TYPED_FILE);
    let files = [
        &[app][..],
        &project_version[1..],
        NESTED_COPY_OF_OTHER_VERSION,
    ]
    .concat();
    let sentence = "it is for version 1.0.0, but 2.0.0 is installed. \
                    Replace it with the full types for 2.0.0, or remove it";
    let expected = load_with_messages(&[project_version_text(sentence)]);
    assert_eq!(describe_load(&files), expected);
}

#[test]
fn manifest_is_compared_with_what_build_defines() {
    const NODE_ENV: &str = "process.env.NODE_ENV";
    let files = project_version_files(SOUND_JSON_FOR_PRODUCTION, TYPED_FILE);
    let text = project_version_text(NEEDS_PRODUCTION);
    assert_eq!(describe_load(&files), load_with_messages(&[text.clone()]));

    with_unreported_packages(&files, |packages| {
        let insufficient: [&[(&str, &str)]; 3] = [
            &[],
            &[(NODE_ENV, "development")],
            &[("NODE_ENV", "production")],
        ];
        for defines in insufficient {
            let printed = print_rejected_versions(packages, defines);
            assert_eq!(printed, [message(Kind::Warn, &text)], "{defines:?}");
        }
        let printed = print_rejected_versions(packages, &[(NODE_ENV, "production")]);
        assert!(printed.is_empty(), "{printed:?}");
    });
}

#[test]
fn typed_version_of_package_that_is_not_loaded_is_not_compared() {
    let mut files = project_version_files(TYPED_PACKAGE_SOUND_JSON, TYPED_FILE).to_vec();
    files.push((".sound/unused/sound.json", "{"));
    let outcome = with_packages(&files, report_without_errors);
    assert!(
        outcome.rejected_versions.is_empty(),
        "{:?}",
        outcome.rejected_versions
    );
    assert_eq!(outcome.printed, [message(Kind::Note, PROJECT_VERSION_USED)]);
}

#[test]
fn demoted_runtime_file_is_not_reported() {
    let files = [("app.js", "import \"node:path\";\n")];
    let outcome = with_loaded_build(&files, &default_settings(), |_, loaded| {
        let packages = loaded.packages(ProjectId::Runtime);
        let file = packages.view.files().compiled_files()[0];
        assert_eq!(packages.view.origin(file), FileOrigin::Runtime);
        let checked = vec![withdraws_trust(packages, file)];
        report(packages, checked, &with_type_errors(&[file]))
    });
    assert!(outcome.printed.is_empty(), "{:?}", outcome.printed);
    assert!(outcome.remaining.is_empty());
    assert!(outcome.demoted_directories.is_empty());
}

#[test]
fn untyped_program_reports_nothing() {
    let outcome = with_packages(DEPENDENCIES, report_without_errors);
    assert!(outcome.rejected_versions.is_empty());
    assert!(outcome.printed.is_empty());
    assert!(outcome.remaining.is_empty());
    assert!(outcome.demoted_directories.is_empty());
}
