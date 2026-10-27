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

#[test]
fn binding_behind_a_getter_that_a_pattern_takes_from_an_awaited_import_stays() {
    let files = [
        (
            "main.mjs",
            "const { a } = await import('./a.cjs'); console.log(a);",
        ),
        (
            "a.cjs",
            "Object.defineProperty(exports, '__esModule', { value: true });\n\
             Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return a; } });\n\
             Object.defineProperty(exports, 'b', { enumerable: true, get: function () { return b; } });\n\
             const a = 1;\n\
             const b = 2;\n\
             exports.default = 3;",
        ),
    ];
    // The definitions have no code where the names are variables. `const a = 1;` stays.
    assert_eq!(
        describe(&files),
        [
            "main.mjs: ES []",
            "a.cjs: names [Object.defineProperty(exports, '__esModule', { value: true }); | \
             Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return a; } }); | \
             Object.defineProperty(exports, 'b', { enumerable: true, get: function () { return b; } }); | \
             const b = 2; | exports.default = 3;]"
        ]
    );
}

#[test]
fn file_that_calls_out_in_front_of_its_names_keeps_its_object_for_an_awaited_import() {
    let files = [
        (
            "main.mjs",
            "const { a } = await import('./a.cjs'); console.log(a);",
        ),
        (
            "a.cjs",
            "Object.defineProperty(exports, '__esModule', { value: true });\n\
             Object.defineProperty(exports, 'a', { enumerable: true, get: function () { return a; } });\n\
             globalThis.called();\n\
             const a = 1;\n\
             exports.b = exports.c = 2;",
        ),
    ];
    assert_eq!(describe(&files), ["main.mjs: ES []", "a.cjs: value []"]);
}

const REQUIRED_LATE: [(&str, &str); 2] = [
    (
        "k.cjs",
        "Object.defineProperty(exports, '__esModule', { value: true });\n\
         globalThis.called();\n\
         exports.default = 1;",
    ),
    (
        "lazy.cjs",
        "exports.lazy = function () { return require('./k.cjs').default; };",
    ),
];

#[test]
fn default_of_a_file_that_is_required_late_is_a_variable_where_only_the_first_load_links_the_file()
{
    let [k, lazy] = REQUIRED_LATE;
    let main =
        "import d from './k.cjs'; import { lazy } from './lazy.cjs'; console.log(d, lazy());";
    assert_eq!(
        describe(&[("main.mjs", main), k, lazy]),
        [
            "main.mjs: ES []",
            "k.cjs: names [Object.defineProperty(exports, '__esModule', { value: true });]",
            "lazy.cjs: names []"
        ]
    );
}

#[test]
fn file_that_is_required_late_keeps_its_object_where_a_module_that_is_loaded_late_asks_for_it() {
    let [k, lazy] = REQUIRED_LATE;
    let main = "import d from './k.cjs'; import { lazy } from './lazy.cjs'; console.log(d, lazy());\n\
                globalThis.called = () => import('./late.mjs');";
    let late = "import './k.cjs';";
    assert_eq!(
        describe(&[("main.mjs", main), k, lazy, ("late.mjs", late)]),
        [
            "main.mjs: ES []",
            "k.cjs: value []",
            "lazy.cjs: names []",
            "late.mjs: ES []"
        ]
    );
}

#[test]
fn file_that_is_required_late_keeps_its_object_where_the_first_load_waits() {
    let [k, lazy] = REQUIRED_LATE;
    let main = "import './waits.mjs'; import d from './k.cjs'; import { lazy } from './lazy.cjs'; console.log(d, lazy());";
    let waits = "await 0;";
    assert_eq!(
        describe(&[("main.mjs", main), k, lazy, ("waits.mjs", waits)]),
        [
            "main.mjs: ES []",
            "k.cjs: value []",
            "lazy.cjs: names []",
            "waits.mjs: ES []"
        ]
    );
}

#[test]
fn name_that_is_read_on_what_require_gives_of_an_es_module_that_hands_it_on_stays() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.mjs'); console.log(a.c);",
        ),
        ("a.mjs", "export { c, f } from './b.cjs';"),
        ("b.cjs", LIBRARY),
    ];
    assert_eq!(
        describe(&files),
        [
            "main.cjs: value []",
            "a.mjs: ES []",
            "b.cjs: names [class K { get() { return 1; } } | exports.f = function (x) { return x; }; | exports.K = K;]"
        ]
    );
}

const QUIET_PACKAGE: (&str, &str) = (
    "node_modules/lib/package.json",
    r#"{ "name": "lib", "version": "1.0.0", "sideEffects": false }"#,
);
const GETTER_OVER_ES_MODULE: &str = "var dep_1 = require('./h2.mjs');\n\
    Object.defineProperty(exports, 'x', { enumerable: true, get: function () { return dep_1.x; } });";
const GETTER_OVER_OWNER: &str = "var dep_1 = require('./owner.cjs');\n\
    Object.defineProperty(exports, 'x', { enumerable: true, get: function () { return dep_1.x; } });";

// The files of the package that do not run.
fn find_files_left_out(main: (&str, &str), owner: &str) -> Vec<String> {
    let files = [
        main,
        QUIET_PACKAGE,
        ("node_modules/lib/h3.cjs", GETTER_OVER_ES_MODULE),
        ("node_modules/lib/h2.mjs", "export { x } from './h1.cjs';"),
        ("node_modules/lib/h1.cjs", GETTER_OVER_OWNER),
        ("node_modules/lib/owner.cjs", owner),
    ];
    let lines = describe(&files).into_iter();
    lines.filter(|line| line.ends_with(": left out")).collect()
}

#[test]
fn files_that_hand_a_name_on_run_for_a_pattern_that_takes_it_from_a_package_without_side_effects() {
    let nothing: [&str; 0] = [];
    let owner = "exports.x = 'five';";
    for main in [
        "var { x } = require('lib/h3.cjs'); console.log(x);",
        "var { x: y = 1 } = require('lib/h3.cjs'); console.log(y);",
        "console.log(require('lib/h3.cjs').x);",
        "var h = require('lib/h3.cjs'); console.log(h.x);",
    ] {
        assert_eq!(
            find_files_left_out(("main.cjs", main), owner),
            nothing,
            "{main}"
        );
    }
    for main in [
        "const { x } = await import('lib/h3.cjs'); console.log(x);",
        "console.log((await import('lib/h3.cjs')).x);",
        "import * as h from 'lib/h3.cjs'; console.log(h.x);",
        "import { x } from 'lib/h3.cjs'; console.log(x);",
    ] {
        assert_eq!(
            find_files_left_out(("main.mjs", main), owner),
            nothing,
            "{main}"
        );
    }
}

#[test]
fn files_that_hand_a_name_on_run_for_the_copy_that_an_importer_has_of_it() {
    let nothing: [&str; 0] = [];
    let owner = "exports.x = 'five'; exports.change = function () { exports.x = 'six'; };";
    for main in [
        "import { x } from 'lib/h3.cjs'; console.log(x);",
        "import * as h from 'lib/h3.cjs'; console.log(h.x);",
        "export { x } from 'lib/h3.cjs';",
    ] {
        assert_eq!(
            find_files_left_out(("main.mjs", main), owner),
            nothing,
            "{main}"
        );
    }
}
