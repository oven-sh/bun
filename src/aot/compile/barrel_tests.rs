use std::num::NonZeroU32;

use bstr::ByteSlice;
use bun_options_types::aot_options::AotOptions;

use super::testing::{default_settings, with_loaded_build_and_options};
use crate::load::ProjectId;
use crate::modules::testing::{file_named, with_graph};

const WITHOUT_SIDE_EFFECTS: (&str, &str) = (
    "node_modules/lib/package.json",
    r#"{ "name": "lib", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": false }"#,
);
const SUBMODULES: [(&str, &str); 3] = [
    (
        "node_modules/lib/a.js",
        "export const a = 1; export default 'a';",
    ),
    (
        "node_modules/lib/b.js",
        "export const b = 2; export default 'b';",
    ),
    (
        "node_modules/lib/c.js",
        "export const c = 3; export default 'c';",
    ),
];
const BARREL: &str =
    "export { a } from './a.js'; export { b } from './b.js'; export { c } from './c.js';";

// The files of the package that are compiled, in the order of the program.
fn load_with_threads(files: &[(&str, &str)], thread_count: u32) -> Vec<String> {
    let options = AotOptions {
        thread_count: NonZeroU32::new(thread_count),
        ..AotOptions::default()
    };
    with_loaded_build_and_options(files, &default_settings(), options, |_, loaded| {
        let files = loaded.project(ProjectId::Application).loaded.files();
        let paths = files
            .compiled_files()
            .iter()
            .map(|&file| files.module(file).file_name());
        let in_package = paths.filter_map(|path| path.strip_prefix(b"/project/node_modules/lib/"));
        in_package.map(|path| path.as_bstr().to_string()).collect()
    })
}

fn load_package(entry_point: &str, manifest: (&str, &str), barrel: &str) -> Vec<String> {
    let mut files = vec![
        ("main.ts", entry_point),
        manifest,
        ("node_modules/lib/index.js", barrel),
    ];
    files.extend(SUBMODULES);
    load_with_threads(&files, 1)
}

fn load(entry_point: &str) -> Vec<String> {
    load_package(entry_point, WITHOUT_SIDE_EFFECTS, BARREL)
}

const ALL: [&str; 4] = ["a.js", "b.js", "c.js", "index.js"];

#[test]
fn named_import_loads_the_module_behind_the_name() {
    assert_eq!(
        load("import { b } from 'lib'; console.log(b);"),
        ["b.js", "index.js"]
    );
    assert_eq!(
        load("import { a, c } from 'lib'; console.log(a, c);"),
        ["a.js", "c.js", "index.js"]
    );
    assert_eq!(
        load("import { b as x } from 'lib'; console.log(x);"),
        ["b.js", "index.js"]
    );
}

#[test]
fn import_for_side_effects_loads_the_barrel_alone() {
    assert_eq!(load("import 'lib';"), ["index.js"]);
}

#[test]
fn import_used_as_a_type_loads_nothing_behind_it() {
    assert_eq!(
        load("import { a, b } from 'lib'; let x: typeof a = 1; console.log(b, x);"),
        ["b.js", "index.js"]
    );
}

#[test]
fn package_that_may_have_side_effects_is_loaded_whole() {
    let entry_point = "import { b } from 'lib'; console.log(b);";
    let manifests = [
        r#"{ "name": "lib", "version": "1.0.0", "type": "module", "main": "index.js" }"#,
        r#"{ "name": "lib", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": true }"#,
        r#"{ "name": "lib", "version": "1.0.0", "type": "module", "main": "index.js", "sideEffects": ["./x.js"] }"#,
    ];
    for manifest in manifests {
        let manifest = (WITHOUT_SIDE_EFFECTS.0, manifest);
        let loaded = load_package(entry_point, manifest, BARREL);
        assert_eq!(loaded, ALL, "{}", manifest.1);
    }
}

#[test]
fn members_read_from_the_object_of_the_module_are_its_names() {
    assert_eq!(
        load("import * as lib from 'lib'; console.log(lib.b);"),
        ["b.js", "index.js"]
    );
    assert_eq!(
        load("import * as lib from 'lib'; console.log(lib['a'], (lib as any).c);"),
        ["a.js", "c.js", "index.js"]
    );
    assert_eq!(
        load("import * as lib from 'lib'; lib.b.toString();"),
        ["b.js", "index.js"]
    );
}

#[test]
fn object_of_the_module_used_otherwise_loads_everything() {
    let entry_points = [
        "import * as lib from 'lib'; console.log(lib);",
        "import * as lib from 'lib'; console.log(lib.a, lib[String('b')]);",
        "import * as lib from 'lib'; export { lib };",
        "import * as lib from 'lib'; const { a } = lib; console.log(a);",
        "import * as lib from 'lib'; (lib as any).a = 1;",
        "export * from 'lib';",
        "export * as lib from 'lib';",
        "console.log(import('lib'));",
        "import lib = require('lib'); console.log(lib.a);",
        "console.log(require('lib'));",
        "const lib = require('lib'); console.log(lib.a, lib);",
        "const lib = require('lib'); console.log(lib[String('a')]);",
        "export const lib = require('lib'); console.log(lib.a);",
        "const lib = require('lib'); export { lib };",
        "const { a, ...others } = require('lib'); console.log(a, others);",
        "const { [String('a')]: a } = require('lib'); console.log(a);",
        "const [a] = require('lib'); console.log(a);",
        "const lib = await import('lib'); console.log(lib);",
        "const lib = import('lib'); console.log(lib.b);",
    ];
    for entry_point in entry_points {
        assert_eq!(load(entry_point), ALL, "{entry_point}");
    }
}

#[test]
fn names_read_from_what_a_call_loads_are_its_names() {
    let entry_points = [
        "console.log(require('lib').b);",
        "console.log((require('lib') as any)['b']);",
        "const { b } = require('lib'); console.log(b);",
        "const { b: x = 1 } = require('lib'); console.log(x);",
        "const lib = require('lib'); console.log(lib.b, lib.b);",
        "console.log(import.meta.require('lib').b);",
        "console.log((await import('lib')).b);",
        "const { b } = await import('lib'); console.log(b);",
        "const lib = await import('lib'); console.log(lib.b);",
        "async function f() { const lib = await import('lib'); return lib.b; } f();",
    ];
    for entry_point in entry_points {
        assert_eq!(load(entry_point), ["b.js", "index.js"], "{entry_point}");
    }
}

// The three tests that follow hold what `bun build` does with each line.
#[test]
fn names_read_through_callbacks_patterns_and_bindings_are_the_names_of_a_call() {
    let entry_points = [
        "import('lib').then(lib => console.log(lib.b));",
        "import('lib').then(({ b }) => console.log(b));",
        "import('lib').then(({ b: x }) => console.log(x), error => console.log(error));",
        "import('lib').then(async lib => console.log(lib.b));",
        "(import('lib') as Promise<any>).then(lib => console.log(lib.b));",
        "let lib = require('lib'); console.log(lib.b);",
        "let lib = await import('lib'); console.log(lib.b);",
        "var { b } = await import('lib'); console.log(b);",
        "let { b } = require('lib'); console.log(b);",
        "export const { b } = await import('lib');",
        "export const { b } = require('lib');",
        "const lib = await import('lib'); const { b } = lib; console.log(b);",
        "const lib = require('lib'); var { b } = lib; console.log(b);",
        "const lib = await import('lib'); if (lib) console.log(lib.b);",
        "const lib = await import('lib'); console.log(!lib, typeof lib, lib && 1, lib == null, undefined !== lib, lib ? 1 : 2, lib.b);",
        "const lib = await import('lib'); console.log(lib?.b);",
        "const { a, b } = await import('lib'); console.log(b);",
        "const { a, b } = require('lib'); console.log(b);",
        "const { b, ...others } = await import('lib'); console.log(b);",
        "const { a, ...others } = await import('lib'); console.log(others.b);",
        "const lib = await import('lib'); const { a, ...others } = lib; console.log(others.b);",
        "const lib = Math.random() > 2 ? require('lib') : null; console.log(lib?.b);",
        "const lib = Math.random() > 2 ? await import('lib') : undefined; console.log(lib && lib.b);",
        "const lib = Math.random() > 2 ? null : Math.random() > 2 ? require('lib') : await import('lib'); console.log(lib.b);",
        "const [lib] = await Promise.all([import('lib')]); console.log(lib.b);",
        "const [{ b }, other] = await Promise.all([import('lib'), 1]); console.log(b, other);",
        "Promise.all([1, import('lib')]).then(([, { b }]) => console.log(b));",
        "Promise.all([import('lib')]).then(([lib]) => console.log(lib.b), () => {});",
        "function f() { return import('lib').then(lib => lib.b); } f();",
    ];
    for entry_point in entry_points {
        assert_eq!(load(entry_point), ["b.js", "index.js"], "{entry_point}");
    }
}

#[test]
fn call_whose_object_nothing_looks_at_loads_the_barrel_alone() {
    let entry_points = [
        "import('lib');",
        "await import('lib');",
        "require('lib');",
        "await require('lib');",
        "import('lib').catch(() => {});",
        "await import('lib').finally(() => {});",
        "import('lib').then(() => console.log(1));",
        "const lib = await import('lib');",
        "const { a } = await import('lib');",
        "const { a } = require('lib');",
        "const [first] = await Promise.all([1, import('lib')]); console.log(first);",
        "const [, ] = await Promise.all([import('lib'), 1]);",
        "Promise.all([import('lib')]).then(() => console.log(1));",
        "const lib = await import('lib'); if (lib) console.log(1);",
    ];
    for entry_point in entry_points {
        assert_eq!(load(entry_point), ["index.js"], "{entry_point}");
    }
}

#[test]
fn object_of_a_call_that_goes_out_of_sight_loads_everything() {
    let entry_points = [
        "import('lib').then(function (lib) { console.log(lib.b); });",
        "import('lib').then((...all) => console.log(all));",
        "import('lib').then((lib = 1) => console.log(lib));",
        "import('lib').then(lib => console.log(lib));",
        "import('lib').then(console.log);",
        "(import('lib').then as any)((lib: any) => console.log(lib.b), 1, 2);",
        "import('lib').then(([a]: any) => console.log(a));",
        "var lib = await import('lib'); console.log(lib.b);",
        "var lib = require('lib'); console.log(lib.b);",
        "export const lib = await import('lib'); console.log(lib.b);",
        "let lib = await import('lib'); lib = 1 as any; console.log(lib.b);",
        "const lib = await import('lib'); while (lib) break;",
        "const lib = await import('lib'); console.log(lib || 1);",
        "const lib = await import('lib'); console.log((lib as any) == 1);",
        "const lib = await import('lib'); const copy = lib; console.log(copy.b);",
        "const lib = await import('lib'); const [x] = lib as any; console.log(x);",
        "export const { b, ...others } = await import('lib');",
        "const { b, ...others } = await import('lib'); console.log(b, others);",
        "const { ['b']: b } = await import('lib'); console.log(b);",
        "console.log((await import('lib'))?.b);",
        "console.log(require('lib')?.b);",
        "const lib = Math.random() > 2 ? require('lib') : 1; console.log(lib.b);",
        "const { b } = Math.random() > 2 ? require('lib') : null; console.log(b);",
        "const [lib, ...more] = await Promise.all([import('lib')]); console.log(lib.b, more);",
        "const [lib = 1] = await Promise.all([import('lib')]); console.log(lib);",
        "var [lib] = await Promise.all([import('lib')]); console.log(lib.b);",
        "export const [lib] = await Promise.all([import('lib')]);",
        "const all = await Promise.all([import('lib')]); console.log(all);",
        "const [lib] = await Promise.all([...[import('lib')]]); console.log(lib.b);",
        "const [lib] = await Promise.allSettled([import('lib')]); console.log(lib);",
        "const Promise = { all: (x: any) => x }; const [lib] = await Promise.all([import('lib')]); console.log(lib);",
        "const lib = await require('lib'); console.log(lib.b);",
        "console.log(await import('lib').catch(() => {}));",
        "const lib = await import('lib'); delete (lib as any).b;",
        "const lib = await import('lib'); console.log(lib?.['b']);",
        "const lib = await import('lib'); console.log({ lib });",
        "const lib = await import('lib'); export { lib };",
        "const lib = await import('lib'); export default lib;",
    ];
    for entry_point in entry_points {
        assert_eq!(load(entry_point), ALL, "{entry_point}");
    }
}
#[test]
fn file_between_asks_for_what_it_exports() {
    let mut files = vec![
        ("main.ts", "import { x } from './between'; console.log(x);"),
        ("between.ts", "export { a as x, c } from 'lib';"),
        WITHOUT_SIDE_EFFECTS,
        ("node_modules/lib/index.js", BARREL),
    ];
    files.extend(SUBMODULES);
    assert_eq!(load_with_threads(&files, 1), ["a.js", "c.js", "index.js"]);
}

#[test]
fn forms_of_an_export_from_another_module_wait() {
    let entry_point = "import { b } from 'lib'; console.log(b);";
    let barrels = [
        "export { default as a } from './a.js'; export { default as b } from './b.js'; export { c } from './c.js';",
        "import { a } from './a.js'; import { b } from './b.js'; import c from './c.js'; export { a, b, c };",
        "export * as a from './a.js'; export * as b from './b.js'; export * as c from './c.js';",
        "import * as a from './a.js'; import * as b from './b.js'; import * as c from './c.js'; export { a, b, c };",
        "export { a, a as a2 } from './a.js'; export { b as 'b' } from './b.js'; export { c as default } from './c.js';",
    ];
    for barrel in barrels {
        let loaded = load_package(entry_point, WITHOUT_SIDE_EFFECTS, barrel);
        assert_eq!(loaded, ["b.js", "index.js"], "{barrel}");
    }
}

#[test]
fn module_that_defines_an_export_is_no_barrel() {
    let entry_point = "import { b } from 'lib'; console.log(b);";
    let modules = [
        "export { a } from './a.js'; export { b } from './b.js'; export { c } from './c.js'; export const d = 4;",
        "export { a } from './a.js'; export { b } from './b.js'; export { c } from './c.js'; export function d() {}",
        "export { a } from './a.js'; export { b } from './b.js'; export { c } from './c.js'; export default 4;",
        "export { a } from './a.js'; export { b } from './b.js'; export { c } from './c.js'; const d = 4; export { d };",
    ];
    for module in modules {
        let loaded = load_package(entry_point, WITHOUT_SIDE_EFFECTS, module);
        assert_eq!(loaded, ALL, "{module}");
    }
}

#[test]
fn import_that_the_barrel_evaluates_does_not_wait() {
    let entry_point = "import { b } from 'lib'; console.log(b);";
    let barrel = "import { a } from './a.js'; import { b } from './b.js'; import { c } from './c.js'; \
         export { a, b, c }; console.log(a);";
    let loaded = load_package(entry_point, WITHOUT_SIDE_EFFECTS, barrel);
    assert_eq!(loaded, ["a.js", "b.js", "index.js"]);
    let barrel = "import { a } from './a.js'; import { b } from './b.js'; export { b }; export { c } from './c.js';";
    let loaded = load_package(entry_point, WITHOUT_SIDE_EFFECTS, barrel);
    assert_eq!(loaded, ["a.js", "b.js", "index.js"]);
}

#[test]
fn whole_export_and_side_effect_import_do_not_wait() {
    let entry_point = "import { b } from 'lib'; console.log(b);";
    let barrel = "export * from './a.js'; export { b } from './b.js'; import './c.js';";
    assert_eq!(load_package(entry_point, WITHOUT_SIDE_EFFECTS, barrel), ALL);
}

#[test]
fn entry_point_is_no_barrel() {
    let mut files = vec![("node_modules/lib/index.js", BARREL), WITHOUT_SIDE_EFFECTS];
    files.extend(SUBMODULES);
    assert_eq!(load_with_threads(&files, 1), ALL);
}

#[test]
fn specifier_behind_a_name_that_nothing_asks_for_is_not_resolved() {
    let barrel = "export { b } from './b.js'; export { missing } from './missing.js';";
    let entry_point = "import { b } from 'lib'; console.log(b);";
    let loaded = load_package(entry_point, WITHOUT_SIDE_EFFECTS, barrel);
    assert_eq!(loaded, ["b.js", "index.js"]);
}

#[test]
fn barrel_exports_what_is_asked_for() {
    let mut files = vec![
        ("main.ts", "import { b } from 'lib'; console.log(b);"),
        WITHOUT_SIDE_EFFECTS,
        ("node_modules/lib/index.js", BARREL),
    ];
    files.extend(SUBMODULES);
    with_graph(&files, |graph, input| {
        let exports = graph.exports(file_named(input, "node_modules/lib/index.js"));
        let names: Vec<&[u8]> = exports
            .iter()
            .map(|it| input.files.atoms.bytes(it.name))
            .collect();
        assert_eq!(names, [b"b"]);
    });
}

const NESTED: [(&str, &str); 12] = [
    (
        "main.ts",
        "import './one'; import './two'; import { deep } from 'lib'; console.log(deep);",
    ),
    ("one.ts", "import { a } from 'lib'; console.log(a);"),
    (
        "two.ts",
        "import * as lib from 'lib'; console.log(lib.inner.c);",
    ),
    WITHOUT_SIDE_EFFECTS,
    (
        "node_modules/lib/index.js",
        "export { a } from './a.js'; export { b } from './b.js'; export * as inner from './inner.js'; \
         export { deep, unused } from './deep.js';",
    ),
    (
        "node_modules/lib/inner.js",
        "export { c } from './c.js'; export { d } from './d.js';",
    ),
    (
        "node_modules/lib/deep.js",
        "export { d as deep } from './d.js'; export { e as unused } from './e.js'; export { b } from './index.js';",
    ),
    ("node_modules/lib/a.js", "export const a = 1;"),
    ("node_modules/lib/b.js", "export const b = 2;"),
    ("node_modules/lib/c.js", "export const c = 3;"),
    ("node_modules/lib/d.js", "export const d = 4;"),
    ("node_modules/lib/e.js", "export const e = 5;"),
];

#[test]
fn files_and_their_order_do_not_depend_on_threads() {
    let expected = load_with_threads(&NESTED, 1);
    assert_eq!(
        expected,
        [
            "a.js", "c.js", "d.js", "inner.js", "e.js", "deep.js", "index.js"
        ]
    );
    for thread_count in [2, 3, 8] {
        for _ in 0..8 {
            let loaded = load_with_threads(&NESTED, thread_count);
            assert_eq!(loaded, expected, "{thread_count} threads");
        }
    }
}
