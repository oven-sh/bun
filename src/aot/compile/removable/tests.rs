use std::fmt::Write;

use bun_core::strings;
use bun_sema::hir::{StmtKind, TextRange};
use bun_sema::program::{FileId, Files};
use bun_sema::resolve::TranspileSettings;

use super::{Removable, RemovableOptions};
use crate::compile::testing::{default_settings, with_loaded_build};
use crate::load::ProjectId;

const TABLE: &str = include_str!("rows.tsv");

const DEPENDENCY: &str = "export const value = \"v\"; export function fn() {} export class Base {} \
     export enum Color { Red, Green } export default 1;";
const JSX_RUNTIME: &str = "export function jsx() {} export function jsxs() {} \
     export function jsxDEV() {} export const Fragment = \"f\";";

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum Bundler {
    Drops,
    Keeps,
    NotAsked,
}

struct Row {
    line: usize,
    is_removable: bool,
    plain: Bundler,
    minified: Bundler,
    difference: &'static str,
    configuration: &'static str,
    extension: &'static str,
    source: &'static str,
}

fn parse_bundler_column(text: &str, line: usize) -> Bundler {
    match text {
        "+" => Bundler::Drops,
        "-" => Bundler::Keeps,
        "." => Bundler::NotAsked,
        _ => panic!("line {line}: {text:?} is no answer of the bundler"),
    }
}

fn parse_table() -> Vec<Row> {
    let lines = (1..).zip(TABLE.lines());
    let rows = lines.filter(|(_, text)| !text.is_empty() && !text.starts_with('#'));
    rows.map(|(line, text)| {
        let columns: Vec<&'static str> = text.split('\t').collect();
        let &[
            answer,
            plain,
            minified,
            difference,
            configuration,
            extension,
            source,
        ] = &columns[..]
        else {
            panic!("line {line} has {} columns", columns.len());
        };
        assert!(
            matches!(answer, "+" | "-"),
            "line {line}: {answer:?} is no answer"
        );
        Row {
            line,
            is_removable: answer == "+",
            plain: parse_bundler_column(plain, line),
            minified: parse_bundler_column(minified, line),
            difference,
            configuration,
            extension,
            source,
        }
    })
    .collect()
}

fn has_mark(files: &Files<'_>, file: FileId, written_at: TextRange) -> bool {
    let text = &files.hir(file).text[written_at.pos as usize..written_at.end as usize];
    strings::contains(text, b"MARK")
}

// The answers for the marked statements of a file. Of a statement with several declarations, the marked ones answer.
fn ask(files: &Files<'_>, file: FileId, options: RemovableOptions) -> Vec<bool> {
    let hir = files.hir(file);
    let removable = Removable::new(files, file, options).expect("the file has a tree");
    let mut answers = Vec::new();
    for statement in hir.ids(hir.body) {
        if !has_mark(files, file, hir[statement].loc) {
            continue;
        }
        match hir[statement].kind {
            StmtKind::Var(declarations) if declarations.len() > 1 => {
                let marked = declarations
                    .iter()
                    .filter(|&it| has_mark(files, file, hir[it].loc));
                answers.extend(marked.map(|declaration| removable.declaration(declaration)));
            }
            _ => answers.push(removable.statement(statement)),
        }
    }
    answers
}

fn with_programs<R>(
    programs: &[(String, &str)],
    settings: &TranspileSettings,
    then: impl FnOnce(&Files<'_>, &[FileId]) -> R,
) -> R {
    let mut entry_point = String::new();
    for (name, _) in programs {
        writeln!(entry_point, "import \"./{name}\";").unwrap();
    }
    let mut sources = vec![
        ("entry.ts", &entry_point[..]),
        ("dep.ts", DEPENDENCY),
        (
            "node_modules/react/package.json",
            "{ \"name\": \"react\", \"version\": \"1.0.0\" }",
        ),
        ("node_modules/react/jsx-runtime.js", JSX_RUNTIME),
        ("node_modules/react/jsx-dev-runtime.js", JSX_RUNTIME),
    ];
    sources.extend(programs.iter().map(|(name, text)| (&name[..], *text)));
    with_loaded_build(&sources, settings, |_, loaded| {
        let files = loaded.project(ProjectId::Application).loaded.files();
        let find = |name: &String| {
            let path = format!("/project/{name}");
            files
                .by_path
                .get(path.as_bytes())
                .unwrap_or_else(|| panic!("{name} is not loaded"))
        };
        let ids: Vec<FileId> = programs.iter().map(|(name, _)| find(name)).collect();
        then(files, &ids)
    })
}

fn ask_one(source: &str, extension: &str, options: RemovableOptions) -> bool {
    let programs = [(format!("program.{extension}"), source)];
    let answers = with_programs(&programs, &default_settings(), |files, ids| {
        ask(files, ids[0], options)
    });
    assert_eq!(answers.len(), 1, "{source}");
    answers[0]
}

#[test]
fn every_row_answers_as_the_table_says() {
    let rows = parse_table();
    assert!(rows.len() >= 150);
    let mut wrong = String::new();
    for configuration in ["-", "legacy"] {
        let settings = TranspileSettings {
            experimental_decorators: configuration == "legacy",
            ..default_settings()
        };
        let rows: Vec<&Row> = rows
            .iter()
            .filter(|row| row.configuration == configuration)
            .collect();
        assert!(!rows.is_empty(), "{configuration}");
        let name_of = |row: &&Row| (format!("row{}.{}", row.line, row.extension), row.source);
        let programs: Vec<(String, &str)> = rows.iter().map(name_of).collect();
        with_programs(&programs, &settings, |files, ids| {
            for (row, &file) in rows.iter().zip(ids) {
                let answers = ask(files, file, RemovableOptions::default());
                if answers.is_empty() || answers.iter().any(|&answer| answer != row.is_removable) {
                    writeln!(wrong, "line {}: {answers:?}: {}", row.line, row.source).unwrap();
                }
            }
        });
    }
    assert!(wrong.is_empty(), "\n{wrong}");
}

#[test]
fn every_configuration_of_the_table_is_run() {
    for row in parse_table() {
        let is_run = matches!(row.configuration, "-" | "legacy");
        assert!(is_run, "line {}", row.line);
    }
}

#[test]
fn every_difference_from_the_bundler_has_its_reason() {
    for row in parse_table() {
        let expected: &[&str] = match (row.is_removable, row.plain) {
            (true, Bundler::Drops) | (false, Bundler::Keeps) | (_, Bundler::NotAsked) => &["-"],
            (true, Bundler::Keeps) => &["folded", "table", "inert"],
            (false, Bundler::Drops) => &["missed"],
        };
        let (line, difference) = (row.line, row.difference);
        assert!(expected.contains(&difference), "line {line}: {difference}");
        let is_monotonic = row.plain != Bundler::Drops || row.minified != Bundler::Keeps;
        assert!(is_monotonic, "line {line}: --minify-syntax keeps more");
    }
}

#[test]
fn annotations_can_be_ignored() {
    let ignoring = RemovableOptions {
        ignores_pure_annotations: true,
        ..RemovableOptions::default()
    };
    let rows = [
        ("function f() {} const MARK = /* @__PURE__ */ f();", "ts"),
        ("class C {} const MARK = /* @__PURE__ */ new C();", "ts"),
        ("const MARK = <div />;", "tsx"),
    ];
    for (source, extension) in rows {
        let plain = RemovableOptions::default();
        assert!(ask_one(source, extension, plain), "{source}");
        assert!(!ask_one(source, extension, ignoring), "{source}");
    }
    assert!(ask_one("const MARK = [1];", "ts", ignoring));
}

#[test]
fn minified_syntax_leaves_out_constructions_of_known_globals() {
    let minifying = RemovableOptions {
        minifies_syntax: true,
        ..RemovableOptions::default()
    };
    let removable = [
        "const MARK = new Map();",
        "const MARK = new Map(null);",
        "const MARK = new Map([[\"a\", 1], [\"b\", 2]]);",
        "const MARK = new Map<string, number>([[\"a\", 1]] as const);",
        "const MARK = new Set();",
        "const MARK = new Set([\"a\", \"b\"]);",
        "const MARK = new Set(undefined);",
        "const MARK = new WeakMap();",
        "const MARK = new WeakSet([]);",
        "const MARK = new Date();",
        "const MARK = new Date(0);",
        "const MARK = [...[\"a\"]];",
        "class MARK { static a = new Map([[\"a\", 1]]); }",
    ];
    for source in removable {
        let plain = RemovableOptions::default();
        assert!(!ask_one(source, "ts", plain), "{source}");
        assert!(ask_one(source, "ts", minifying), "{source}");
    }
    let kept = [
        "function f(...a: any[]): any {} const MARK = new Map([[f(), 1]]);",
        "const xs: any = []; const MARK = new Map(xs);",
        "const xs: any = []; const MARK = new Map([xs]);",
        "const xs: any = []; const MARK = new Set(xs);",
        "const xs: any = []; const MARK = new Set([...xs]);",
        "const o: any = {}; const MARK = new WeakSet([o]);",
        "const o: any = {}; const MARK = new Date(o);",
        "class Map { constructor(a?: any) { sideEffect(); } } declare function sideEffect(): void; const MARK = new Map();",
        "const MARK = new Map([], 1 as any);",
    ];
    for source in kept {
        assert!(!ask_one(source, "ts", minifying), "{source}");
    }
}

#[test]
fn jsx_can_have_side_effects() {
    let with_side_effects = RemovableOptions {
        jsx_has_side_effects: true,
        ..RemovableOptions::default()
    };
    assert!(!ask_one("const MARK = <div />;", "tsx", with_side_effects));
    assert!(!ask_one("const MARK = <></>;", "tsx", with_side_effects));
    let call = "function f() {} const MARK = /* @__PURE__ */ f();";
    assert!(ask_one(call, "tsx", with_side_effects));
}

#[test]
fn statement_with_several_declarations_needs_all_of_them() {
    let sources = [
        ("function f() {} const a = f(), MARK = 1;", false),
        ("function f() {} const MARK = 1, b = f();", false),
        ("const MARK = 1, b = 2;", true),
    ];
    for (source, expected) in sources {
        let programs = [("program.ts".to_owned(), source)];
        let answer = with_programs(&programs, &default_settings(), |files, ids| {
            let hir = files.hir(ids[0]);
            let options = RemovableOptions::default();
            let removable = Removable::new(files, ids[0], options).unwrap();
            let last = hir.ids(hir.body).next_back().unwrap();
            removable.statement(last)
        });
        assert_eq!(answer, expected, "{source}");
    }
}
