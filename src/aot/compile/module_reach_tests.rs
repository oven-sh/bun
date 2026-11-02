use std::fmt::Write;

use bstr::ByteSlice;
use bun_sema::hir::{ExprKind, StmtId, StmtKind};
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

const STORED_ONCE: &str = "exports.x = 'five';";
const STORED_AGAIN: &str =
    "exports.x = 'five'; exports.change = function () { exports.x = 'six'; };";

#[test]
fn files_that_hand_a_name_on_run_for_whoever_takes_it_from_a_package_without_side_effects() {
    let nothing: [&str; 0] = [];
    let required = [
        "var { x } = require('lib/h3.cjs'); console.log(x);",
        "var { x: y = 1 } = require('lib/h3.cjs'); console.log(y);",
        "console.log(require('lib/h3.cjs').x);",
        "var h = require('lib/h3.cjs'); console.log(h.x);",
    ];
    let imported = [
        "const { x } = await import('lib/h3.cjs'); console.log(x);",
        "console.log((await import('lib/h3.cjs')).x);",
        "import * as h from 'lib/h3.cjs'; console.log(h.x);",
        "import { x } from 'lib/h3.cjs'; console.log(x);",
        "export { x } from 'lib/h3.cjs';",
    ];
    for owner in [STORED_ONCE, STORED_AGAIN] {
        let mains = required.iter().map(|&main| ("main.cjs", main));
        for main in mains.chain(imported.iter().map(|&main| ("main.mjs", main))) {
            assert_eq!(
                find_files_left_out(main, owner),
                nothing,
                "{main:?} {owner}"
            );
        }
    }
}

#[test]
fn files_that_hand_a_value_of_a_json_file_on_run_for_whoever_reads_it() {
    let package = r#"{ "name": "lib", "version": "1.0.0", "sideEffects": ["./setup.mjs"] }"#;
    let by_name = "globalThis.ready = true; export { version } from './package.json';";
    let whole = "globalThis.ready = true; export { default as data } from './package.json';";
    let cases = [
        (by_name, "version", "version"),
        (whole, "data", "data.version"),
    ];
    for (setup, name, read) in cases {
        let main = format!("import {{ {name} }} from 'lib/barrel.mjs'; console.log({read});");
        let barrel = format!("export {{ {name} }} from './setup.mjs';");
        let files = [
            ("main.mjs", main.as_str()),
            ("node_modules/lib/package.json", package),
            ("node_modules/lib/barrel.mjs", barrel.as_str()),
            ("node_modules/lib/setup.mjs", setup),
        ];
        let lines = describe(&files).into_iter();
        let left_out: Vec<String> = lines.filter(|line| line.ends_with(": left out")).collect();
        assert_eq!(left_out, [""; 0], "{read}");
    }
}

// Of each class of main.mjs that is left out: its name, whether what it extends is still checked, and how many of its keys are still converted.
fn describe_unused_classes(files: &[(&str, &str)]) -> Vec<String> {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let Ok(bound) = build.bind_modules(loaded) else {
            panic!("the modules were not bound");
        };
        let files = loaded.project(ProjectId::Application).loaded.files();
        let file = files.by_path.get(b"/project/main.mjs").unwrap();
        let hir = files.hir(file);
        let declarations = &bound.projects.application.left_out.declarations;
        let mut lines = Vec::new();
        for statement in hir.ids(hir.body) {
            let (class, is_left_out) = match hir[statement].kind {
                StmtKind::Class(class) => (class, declarations.is_class_left_out(file, class)),
                StmtKind::Var(declarators) => {
                    let declarator = declarators.iter().next().unwrap();
                    let ExprKind::Class(class) = hir[hir[declarator].init].kind else {
                        continue;
                    };
                    let is_left_out = declarations.is_declarator_left_out(file, declarator);
                    (class, is_left_out)
                }
                _ => continue,
            };
            if is_left_out {
                let name = files.atoms.bytes(hir[class].name).as_bstr();
                let is_checked = declarations.is_heritage_check_kept(file, class);
                let members = hir[class].members.iter();
                let keys = members
                    .filter(|&member| declarations.is_key_conversion_kept(file, member))
                    .count();
                let mut line = format!("{name}{}", if is_checked { ": checked" } else { "" });
                if keys > 0 {
                    write!(line, ": {keys} keys").unwrap();
                }
                lines.push(line);
            }
        }
        lines
    })
}

const BASES: &str = "export class Declared {}\n\
    export const constant = class {};\n\
    export var variable = class {};\n\
    export let stored = class {}; stored = {};\n\
    if (globalThis.nothing) { var conditional = class {}; } export { conditional };\n\
    export function ordinary() {}\n\
    export const object = {};\n\
    export default class {}";

#[test]
fn unused_class_is_left_out_whole_where_it_extends_a_class_or_null() {
    let main = "import Default, * as bases from './bases.mjs';\n\
        import { Declared, constant, variable } from './bases.mjs';\n\
        class A {}\n\
        class B extends A {}\n\
        class C extends null {}\n\
        class D extends class {} {}\n\
        class E extends function () {} {}\n\
        class F extends Array {}\n\
        class G extends Declared {}\n\
        class H extends constant {}\n\
        class I extends variable {}\n\
        class J extends bases.Declared {}\n\
        class K extends Default {}\n\
        var L = class L extends A {};\n\
        class M extends L {}\n\
        class N extends (typeof missing === 'string' ? A : null) {}";
    assert_eq!(
        describe_unused_classes(&[("main.mjs", main), ("bases.mjs", BASES)]),
        [
            "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N"
        ]
    );
}

#[test]
fn unused_class_leaves_the_check_of_what_else_it_extends() {
    let main = "import * as bases from './bases.mjs';\n\
        import { stored, conditional, ordinary, object } from './bases.mjs';\n\
        class A extends {} {}\n\
        class B extends undefined {}\n\
        class C extends (() => {}) {}\n\
        class D extends Error {}\n\
        class E extends Math {}\n\
        class F extends Proxy {}\n\
        class G extends stored {}\n\
        class H extends conditional {}\n\
        class I extends ordinary {}\n\
        class J extends object {}\n\
        class K extends bases.object {}\n\
        class L extends later {}\n\
        var later = class {};\n\
        let replaced = class {}; replaced = 1;\n\
        class M extends replaced {}\n\
        var N = class N extends {} {};\n\
        class O extends (typeof missing === 'string' ? Array : {}) {}";
    let checked = "ABCDEFGHIJKLMNO"
        .chars()
        .map(|name| format!("{name}: checked"));
    assert_eq!(
        describe_unused_classes(&[("main.mjs", main), ("bases.mjs", BASES)]),
        checked.collect::<Vec<_>>()
    );
}

#[test]
fn unused_class_leaves_the_check_of_an_import_whose_module_may_not_have_run() {
    let main = "import { variable } from './late.mjs';\nclass A extends variable {}";
    let late = "import './main.mjs';\nexport var variable = class {};";
    assert_eq!(
        describe_unused_classes(&[("main.mjs", main), ("late.mjs", late)]),
        ["A: checked"]
    );
}

#[test]
fn what_an_unused_class_extends_stays_where_it_is_checked() {
    let files = [
        (
            "main.mjs",
            "import { make } from './a.mjs'; class Unused extends make {}",
        ),
        (
            "a.mjs",
            "export function make() {} export function other() {}",
        ),
    ];
    assert_eq!(
        describe(&files),
        [
            "main.mjs: ES [class Unused extends make {}]",
            "a.mjs: ES []",
        ]
    );
}

#[test]
fn unused_class_leaves_the_conversion_of_keys_that_may_be_objects() {
    let main = "const text = 'a'; const first = {}; const second = {};\n\
        class A { [text]() {} ['b']() {} [1] = 1; static [text]() {} }\n\
        class B { [Symbol.iterator]() {} static [Symbol.hasInstance]() {} }\n\
        class C { [first]() {} }\n\
        class D { [first]() {} plain() {} [second] = 1; get [text]() { return 1; } }\n\
        class E extends first { [second]() {} }\n\
        var F = class F { [first]() {} };\n\
        class G { static [first]() {} }\n\
        class H { static ['prototype']() {} }\n\
        class I { static ['prototype'] = 1; }";
    assert_eq!(
        describe_unused_classes(&[("main.mjs", main)]),
        [
            "A",
            "B",
            "C: 1 keys",
            "D: 2 keys",
            "E: checked: 1 keys",
            "F: 1 keys"
        ]
    );
}

#[test]
fn class_stored_under_a_name_that_nobody_reads_leaves_its_checks() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(a.used);",
        ),
        (
            "a.cjs",
            "function Base() {}\n\
            exports.A = class extends Base {};\n\
            exports.B = class {};\n\
            exports.used = 1;",
        ),
    ];
    assert_eq!(
        describe(&files),
        [
            "main.cjs: value []",
            "a.cjs: names [exports.A = class extends Base {}; | exports.B = class {};]",
        ]
    );
}
