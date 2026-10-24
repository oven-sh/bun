use bstr::ByteSlice;
use bun_sema::hir::{StmtId, StmtKind};
use bun_sema::program::FileId;

use super::testing::{default_settings, with_loaded_build};
use super::{BoundProject, LoadedBuild};
use crate::load::ProjectId;
use crate::modules::{ModuleRef, Shape};

fn describe_project(loaded: &LoadedBuild<'_, '_>, bound: &BoundProject<'_>) -> Vec<String> {
    let files = loaded.project(ProjectId::Application).loaded.files();
    let describe_file = |file: FileId| {
        let name = files.module(file).file_name();
        let name = name.strip_prefix(b"/project/")?.as_bstr().to_string();
        if bound.left_out.files.binary_search(&file).is_ok() {
            return Some(format!("{name}: left out"));
        }
        let hir = files.hir(file);
        let declarations = &bound.left_out.declarations;
        let is_left_out = |statement: StmtId| match hir[statement].kind {
            StmtKind::Class(class) => declarations.is_class_left_out(file, class),
            StmtKind::Var(declarators) => declarators
                .iter()
                .all(|it| declarations.is_declarator_left_out(file, it)),
            _ => declarations.is_statement_left_out(file, statement),
        };
        let left_out = hir
            .ids(hir.body)
            .filter(|&statement| is_left_out(statement));
        let texts: Vec<String> = left_out
            .map(|statement| {
                let written_at = hir[statement].loc;
                let text = &hir.text[written_at.pos as usize..written_at.end as usize];
                text.trim_ascii().as_bstr().to_string()
            })
            .collect();
        let shape = match bound.graph.shape(ModuleRef::File(file)) {
            Shape::EsModule => "ES",
            Shape::Names => "names",
            Shape::Value => "value",
            Shape::AsToday => "as today",
        };
        Some(format!("{name}: {shape} [{}]", texts.join(" | ")))
    };
    files
        .compiled_files()
        .iter()
        .filter_map(|&file| describe_file(file))
        .collect()
}

// In the order in which the test lists the files.
fn describe(files: &[(&str, &str)]) -> Vec<String> {
    let mut lines = with_loaded_build(files, &default_settings(), |build, loaded| {
        let Ok(bound) = build.bind_modules(loaded) else {
            panic!("the modules were not bound");
        };
        describe_project(loaded, &bound.projects.application)
    });
    lines.sort_by_key(|line| {
        files
            .iter()
            .position(|(name, _)| line.starts_with(&format!("{name}:")))
    });
    lines
}

const LIBRARY: &str = "class K { get() { return 1; } }\n\
    exports.c = 1;\n\
    exports.f = function (x) { return x; };\n\
    exports.K = K;";

#[test]
fn store_under_a_name_that_nobody_reads_goes_with_what_it_alone_names() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(a.c);",
        ),
        ("a.cjs", LIBRARY),
    ];
    assert_eq!(
        describe(&files),
        [
            "main.cjs: value []",
            "a.cjs: names [class K { get() { return 1; } } | exports.f = function (x) { return x; }; | exports.K = K;]",
        ]
    );
}

#[test]
fn name_that_a_pattern_reads_stays() {
    let files = [
        (
            "main.cjs",
            "const { K, f: g = null } = require('./a.cjs'); console.log(K, g);",
        ),
        ("a.cjs", LIBRARY),
    ];
    assert_eq!(
        describe(&files),
        ["main.cjs: value []", "a.cjs: names [exports.c = 1;]"]
    );
}

#[test]
fn name_that_the_module_itself_reads_stays() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(a.f());",
        ),
        (
            "a.cjs",
            "exports.c = 1;\nexports.d = 2;\nexports.f = function () { return exports.c; };",
        ),
    ];
    assert_eq!(
        describe(&files),
        ["main.cjs: value []", "a.cjs: names [exports.d = 2;]"]
    );
}

#[test]
fn name_that_an_es_module_imports_stays() {
    let files = [
        (
            "main.mjs",
            "import { f } from './a.cjs'; console.log(f(1));",
        ),
        ("a.cjs", LIBRARY),
    ];
    assert_eq!(
        describe(&files),
        [
            "main.mjs: ES []",
            "a.cjs: names [class K { get() { return 1; } } | exports.c = 1; | exports.K = K;]",
        ]
    );
}

#[test]
fn store_whose_value_does_something_stays() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        ("a.cjs", "exports.c = console.log(1);\nexports.d = 2;"),
    ];
    assert_eq!(
        describe(&files),
        ["main.cjs: value []", "a.cjs: names [exports.d = 2;]"]
    );
}

#[test]
fn object_that_somebody_looks_at_keeps_every_name() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(Object.keys(a));",
        ),
        ("a.cjs", LIBRARY),
    ];
    assert_eq!(describe(&files), ["main.cjs: value []", "a.cjs: value []"]);
}

#[test]
fn function_that_may_read_this_makes_the_object_a_value() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(a.f());",
        ),
        (
            "a.cjs",
            "exports.c = 1;\nexports.f = function () { return this.c; };",
        ),
    ];
    assert_eq!(describe(&files), ["main.cjs: value []", "a.cjs: value []"]);
}

#[test]
fn file_that_only_a_function_requires_that_nothing_calls_is_left_out() {
    let files = [
        (
            "main.cjs",
            "function unused() { return require('./a.cjs'); }\nconsole.log(1);",
        ),
        ("a.cjs", LIBRARY),
    ];
    assert_eq!(describe(&files), ["main.cjs: value []", "a.cjs: left out"]);
}

#[test]
fn module_that_takes_names_from_a_module_with_an_object_has_one_too() {
    let barrel = "const a_1 = require('./a.cjs');\n\
        Object.defineProperty(exports, 'c', { enumerable: true, get: function () { return a_1.c; } });";
    let reads_names = "const b = require('./barrel.cjs'); console.log(b.c);";
    let looks =
        "const b = require('./barrel.cjs'); console.log(b.c, Object.keys(require('./a.cjs')));";
    let shapes_with = |main: &str| {
        let files = [
            ("main.cjs", main),
            ("barrel.cjs", barrel),
            ("a.cjs", "exports.c = 1;"),
        ];
        let lines = describe(&files);
        let shapes = lines
            .iter()
            .map(|line| line.split(' ').nth(1).unwrap_or_default().to_owned());
        shapes.collect::<Vec<String>>()
    };
    assert_eq!(shapes_with(reads_names), ["value", "names", "names"]);
    assert_eq!(shapes_with(looks), ["value", "value", "value"]);
}

#[test]
fn children_of_a_module_have_objects() {
    let files = [
        (
            "main.cjs",
            "require('./a.cjs'); console.log(module.children[0].exports);",
        ),
        ("a.cjs", "require('./b.cjs');\nexports.c = 1;"),
        ("b.cjs", "exports.d = 2;"),
    ];
    assert_eq!(
        describe(&files),
        ["main.cjs: value []", "a.cjs: value []", "b.cjs: value []"]
    );
}

#[test]
fn test_of_the_main_module_costs_nothing() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(a.c);",
        ),
        (
            "a.cjs",
            "exports.c = 1;\nif (require.main === module) console.log(2);",
        ),
    ];
    assert_eq!(describe(&files), ["main.cjs: value []", "a.cjs: names []"]);
}
