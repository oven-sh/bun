use std::fmt::Write;

use bstr::ByteSlice;
use bun_options_types::aot_options::AotOptions;
use bun_sema::hir::{ExprKind, StmtId, StmtKind};
use bun_sema::program::FileId;

use super::testing::{default_settings, with_loaded_build, with_loaded_build_and_options};
use super::{BoundProject, LoadedBuild};
use crate::ir::generated::ModuleRequestKind;
use crate::load::ProjectId;
use crate::modules::{ModuleRef, Shape};

fn describe_project(loaded: &LoadedBuild<'_, '_>, bound: &BoundProject) -> Vec<String> {
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
        let module = ModuleRef::File(file);
        let shape = match bound.graph.shape(module) {
            Shape::EsModule => "ES",
            Shape::Names => "names",
            Shape::Value => "value",
            Shape::AsToday => "as today",
        };
        let module_object = match bound.graph.keeps_module_object(module) {
            true => " with module object",
            false => "",
        };
        Some(format!(
            "{name}: {shape}{module_object} [{}]",
            texts.join(" | ")
        ))
    };
    files
        .compiled_files()
        .iter()
        .filter_map(|&file| describe_file(file))
        .collect()
}

fn describe(files: &[(&str, &str)]) -> Vec<String> {
    describe_with_options(files, AotOptions::default())
}

fn describe_with_options(files: &[(&str, &str)], aot: AotOptions) -> Vec<String> {
    let settings = default_settings();
    let mut lines = with_loaded_build_and_options(files, &settings, aot, |build, loaded| {
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
fn nothing_is_left_out_under_the_inspector() {
    let files = [
        (
            "main.cjs",
            "const a = require('./a.cjs'); console.log(a.c);",
        ),
        ("a.cjs", LIBRARY),
    ];
    let aot = AotOptions {
        admits_inspector: true,
        ..AotOptions::default()
    };
    let described = describe_with_options(&files, aot);
    assert!(
        described.iter().all(|line| line.ends_with(" []")),
        "{described:?}"
    );
}

#[derive(Copy, Clone)]
enum CodeFromDisk {
    Refused,
    Isolated,
    Allowed,
}

fn describe_package_beside(load: &str, code_from_disk: CodeFromDisk) -> String {
    let main = format!("const a = require('lib/a.cjs'); console.log(a.c); {load};");
    let files = [
        ("main.cjs", main.as_str()),
        ("node_modules/lib/a.cjs", LIBRARY),
    ];
    let aot = AotOptions {
        loads_code_from_disk: !matches!(code_from_disk, CodeFromDisk::Refused),
        isolates_code_from_disk: matches!(code_from_disk, CodeFromDisk::Isolated),
        ..AotOptions::default()
    };
    describe_with_options(&files, aot).swap_remove(1)
}

#[test]
fn load_under_an_unknown_name_finds_what_it_finds_without_code_from_disk_where_that_code_is_isolated()
 {
    let load = "import(process.argv[2])";
    let refused = describe_package_beside(load, CodeFromDisk::Refused);
    assert!(!refused.ends_with(" []"), "{refused}");
    assert_eq!(
        describe_package_beside(load, CodeFromDisk::Isolated),
        refused
    );
}

#[test]
fn file_that_was_missing_at_the_build_names_the_files_of_the_program_unless_it_is_isolated() {
    let load = "import('./made.mjs')";
    let isolated = describe_package_beside(load, CodeFromDisk::Isolated);
    assert_eq!(
        isolated,
        describe_package_beside("0", CodeFromDisk::Refused)
    );
    let allowed = describe_package_beside(load, CodeFromDisk::Allowed);
    assert!(allowed.ends_with(" []"), "{allowed}");
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
        [
            "main.cjs: value with module object []",
            "a.cjs: value with module object []",
            "b.cjs: value with module object []",
        ]
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

fn describe_files_beside(code: &str) -> Vec<String> {
    let main = format!("require('./a.cjs');\n{code}");
    let files = [
        ("main.cjs", main.as_str()),
        ("a.cjs", "require('./b.cjs');\nexports.c = 1;"),
        ("b.cjs", "exports.d = 2;"),
    ];
    describe(&files).split_off(1)
}

const WITHOUT_OBJECTS: [&str; 2] = [
    "a.cjs: names [exports.c = 1;]",
    "b.cjs: names [exports.d = 2;]",
];
const WITH_OBJECTS: [&str; 2] = [
    "a.cjs: value with module object []",
    "b.cjs: value with module object []",
];

#[test]
fn no_file_has_an_object_where_no_code_names_a_way_to_module_objects() {
    assert_eq!(describe_files_beside("console.log(1);"), WITHOUT_OBJECTS);
}

#[test]
fn every_file_has_an_object_where_code_names_the_parent_of_a_module() {
    for code in [
        "console.log(module.parent.id);",
        "if (!module.parent) console.log(2);",
    ] {
        assert_eq!(describe_files_beside(code), WITH_OBJECTS, "{code}");
    }
}

#[test]
fn every_file_has_an_object_where_code_reads_the_main_module() {
    for code in [
        "console.log(require.main.filename);",
        "console.log(require.main);",
    ] {
        assert_eq!(describe_files_beside(code), WITH_OBJECTS, "{code}");
    }
}

#[test]
fn every_file_has_an_object_where_code_names_the_main_module_of_the_process() {
    assert_eq!(
        describe_files_beside("console.log(process.mainModule);"),
        WITH_OBJECTS
    );
}

#[test]
fn no_file_of_an_executable_has_an_object_where_code_reads_the_table_of_loaded_modules() {
    for code in [
        "console.log(require.cache[__filename].loaded);",
        "for (const key of Object.keys(require.cache)) console.log(require.cache[key].exports === module.exports);",
        "const entry = require.cache[__filename];\nconsole.log(entry && entry.id, entry && entry.filename);",
        "const entry = require.cache[__filename];\nif (entry) console.log(entry.loaded);",
        "const entry = require.cache[__filename];",
    ] {
        assert_eq!(describe_files_beside(code), WITHOUT_OBJECTS, "{code}");
    }
    for code in [
        "require.cache[__filename] = undefined;",
        "delete require.cache[__filename];",
        "require.cache['fs'] = { exports: 1 };",
        "console.log(require.cache);",
    ] {
        assert_eq!(describe_files_beside(code), WITH_OBJECTS, "{code}");
    }
}

#[test]
fn every_file_has_an_object_where_code_goes_on_from_an_entry_of_the_table_of_loaded_modules() {
    for code in [
        "console.log(require.cache[__filename].parent);",
        "console.log(require.cache['/etc/app/config.json'].parent.exports);",
        "const entry = require.cache[__filename];\nconsole.log(entry.parent.exports);",
        "console.log(require.cache[__filename].children.length);",
        "console.log(require('node:module')._cache[__filename].parent.id);",
        "console.log(require.cache[__filename]);",
        "const entry = require.cache[__filename];\nconsole.log(entry);",
        "const entry = require.cache[__filename];\nconsole.log(entry.children.length);",
        "let entry = require.cache[__filename];\nentry = entry.parent;\nconsole.log(entry.id);",
    ] {
        assert_eq!(describe_files_beside(code), WITH_OBJECTS, "{code}");
    }
}

#[test]
fn only_the_file_itself_has_an_object_where_it_lays_a_descriptor_under_its_exports() {
    let beside = |a: &str| {
        let files = [
            ("main.cjs", "console.log(require('./a.cjs'));"),
            ("a.cjs", a),
            ("b.cjs", "exports.d = 2;"),
        ];
        describe(&files).remove(2)
    };
    for written_out in [
        "require('./b.cjs');\nObject.defineProperty(module, 'exports', { get() { return 1; } });",
        "require('./b.cjs');\nObject.defineProperty(module, 'exports', { get: function () { return 1; }, configurable: true });",
        "require('./b.cjs');\nReflect.defineProperty(module, 'exports', { value: 1 });",
    ] {
        assert_eq!(beside(written_out), WITHOUT_OBJECTS[1], "{written_out}");
    }
    for handed_on in [
        "require('./b.cjs');\nObject.defineProperty(module, 'exports', { get() { return this.children; } });",
        "require('./b.cjs');\nfunction get() { return this.children; }\nObject.defineProperty(module, 'exports', { get });",
        "require('./b.cjs');\nfunction reads() { return this.children; }\nObject.defineProperty(module, 'exports', { get: reads });",
        "require('./b.cjs');\nconst descriptor = { get() { return this.children; } };\nObject.defineProperty(module, 'exports', descriptor);",
        "require('./b.cjs');\nconsole.log(Object.defineProperty(module, 'exports', { value: 1 }));",
        "require('./b.cjs');\nObject.defineProperty(module, 'children', { value: 1 });",
        "require('./b.cjs');\nObject.defineProperty(module, Math.random() ? 'exports' : 'children', { value: 1 });",
        "require('./b.cjs');\nObject.defineProperties(module, { exports: { value: 1 } });",
    ] {
        assert_eq!(beside(handed_on), WITH_OBJECTS[1], "{handed_on}");
    }
}

#[test]
fn every_file_has_an_object_where_code_stores_a_function_of_the_loader() {
    for member in ["_resolveFilename", "_load", "prototype.require"] {
        let code = format!(
            "const Module = require('node:module');\n\
             Module.{member} = function (name) {{ return name; }};"
        );
        assert_eq!(describe_files_beside(&code), WITH_OBJECTS, "{member}");
    }
}

#[test]
fn every_file_has_an_object_where_code_below_an_es_module_may_write_a_table_of_loaders() {
    let loader = "function (made) { made.exports = made.parent.exports; }";
    for store in [
        "require.extensions['.json'] = LOADER;",
        "require('node:module')._extensions['.json'] = LOADER;",
        "for (const ending of ['.json']) require('node:module')._extensions[ending] = LOADER;",
        "const table = require.extensions;\ntable['.json'] = LOADER;",
        "const { _extensions } = require('node:module');\n_extensions['.json'] = LOADER;",
        "Object.assign(require.extensions, { '.json': LOADER });",
        "function lay() { require.extensions['.json'] = LOADER; }\nlay();",
    ] {
        let code = store.replace("LOADER", loader);
        assert_eq!(
            describe_files_below_an_es_module(&code),
            WITH_OBJECTS,
            "{code}"
        );
    }
}

#[test]
fn store_into_a_table_of_loaders_in_a_function_that_nothing_calls_costs_nothing() {
    let code = "function unused() { require.extensions['.json'] = made => made.parent; }";
    assert_eq!(describe_files_below_an_es_module(code), WITHOUT_OBJECTS);
}

fn describe_files_below_an_es_module(code: &str) -> Vec<String> {
    let start = format!("require('./a.cjs');\n{code}");
    let files = [
        ("main.mjs", "import './start.cjs';"),
        ("start.cjs", start.as_str()),
        ("a.cjs", "require('./b.cjs');\nexports.c = 1;"),
        ("b.cjs", "exports.d = 2;"),
    ];
    describe(&files).split_off(2)
}

#[test]
fn every_file_has_an_object_where_process_goes_somewhere_as_a_value() {
    let code = "console.log(process);";
    assert_eq!(describe_files_beside(code), WITH_OBJECTS);
}

#[test]
fn every_file_has_an_object_where_the_object_of_a_module_goes_somewhere_as_a_value() {
    assert_eq!(describe_files_beside("console.log(module);"), WITH_OBJECTS);
}

#[test]
fn every_file_has_an_object_where_require_goes_somewhere_as_a_value() {
    for code in [
        "console.log(require);",
        "console.log(require.__proto__.main);",
        "console.log(arguments.length);",
        "console.log(require('node:module').createRequire);",
    ] {
        assert_eq!(describe_files_beside(code), WITH_OBJECTS, "{code}");
    }
}

#[test]
fn every_file_has_an_object_where_text_left_to_the_run_time_names_the_main_module() {
    let code = r#"(0, eval)("process.mainModule.children");"#;
    assert_eq!(describe_files_beside(code), WITH_OBJECTS);
}

#[test]
fn test_of_whether_there_is_a_main_module_costs_nothing() {
    assert_eq!(
        describe_files_beside("if (!require.main) console.log(2);"),
        WITHOUT_OBJECTS
    );
}

#[test]
fn way_to_the_objects_of_modules_in_a_function_that_nothing_calls_costs_nothing() {
    let code = "function unused() { return module.children; }";
    assert_eq!(describe_files_beside(code), WITHOUT_OBJECTS);
}

const WAYS_TO_MODULE_OBJECTS: [&str; 5] = [
    "if (!module.parent) console.log(2);",
    "console.log(module.parent.id);",
    "console.log(module.children[0].exports);",
    "console.log(module);",
    "const Module = require('node:module'); Module._load = function (name) { return name; };",
];
const ES_LIBRARY: &str =
    "export function used() { return 1; }\nclass Unused {}\nexport { Unused };";
const WITHOUT_UNUSED: &str = "lib.mjs: ES [class Unused {}]";

#[test]
fn es_module_that_import_alone_loads_keeps_only_what_is_imported_where_code_names_a_way() {
    for way in WAYS_TO_MODULE_OBJECTS {
        let files = [
            (
                "main.mjs",
                "import { used } from './lib.mjs';\nimport './way.cjs';\nconsole.log(used());",
            ),
            ("lib.mjs", ES_LIBRARY),
            ("way.cjs", way),
        ];
        let lines = describe(&files);
        assert_eq!(lines[0], "main.mjs: ES []", "{way}");
        assert_eq!(lines[1], WITHOUT_UNUSED, "{way}");
    }
}

#[test]
fn es_module_that_require_loads_keeps_every_export_where_code_names_a_way() {
    let describe_library = |way: &str| {
        let main = format!("const lib = require('./lib.mjs');\nconsole.log(lib.used());\n{way}");
        describe(&[("main.cjs", main.as_str()), ("lib.mjs", ES_LIBRARY)]).remove(1)
    };
    assert_eq!(describe_library(""), WITHOUT_UNUSED);
    for way in WAYS_TO_MODULE_OBJECTS {
        assert_eq!(
            describe_library(way),
            "lib.mjs: ES with module object []",
            "{way}"
        );
    }
}

#[test]
fn es_module_that_an_es_module_alone_requires_keeps_only_what_is_read_where_code_names_a_way() {
    for way in WAYS_TO_MODULE_OBJECTS {
        let files = [
            (
                "main.mjs",
                "import './way.cjs';\nconst lib = import.meta.require('./lib.mjs');\nconsole.log(lib.used());",
            ),
            ("lib.mjs", ES_LIBRARY),
            ("way.cjs", way),
        ];
        assert_eq!(describe(&files)[1], WITHOUT_UNUSED, "{way}");
    }
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
fn a_name_that_may_find_the_main_file_links_nothing_anew() {
    let [k, (lazy_name, lazy)] = REQUIRED_LATE;
    let lazy = format!("{lazy} exports.load = (name) => require(name);");
    let main =
        "import d from './k.cjs'; import { lazy } from './lazy.cjs'; console.log(d, lazy());";
    assert_eq!(
        describe(&[("main.mjs", main), k, (lazy_name, &lazy)])[1],
        "k.cjs: names [Object.defineProperty(exports, '__esModule', { value: true });]"
    );
}

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

fn runs_runtime_of_elements(main: &str) -> bool {
    let runtime =
        "exports.jsx = exports.jsxs = exports.jsxDEV = function () {}; exports.Fragment = 'f';";
    let files = [
        ("main.tsx", main),
        ("node_modules/react/jsx-runtime.js", runtime),
        ("node_modules/react/jsx-dev-runtime.js", runtime),
    ];
    let lines = describe(&files);
    lines[1..].iter().any(|line| !line.ends_with(": left out"))
}

#[test]
fn runtime_of_elements_runs_where_the_bundler_keeps_a_statement_that_holds_one() {
    let dropped = [
        "const unused = <a />;",
        "let unused = <></>;",
        "<a />;",
        "function dead() { return <a />; }",
        "const view = () => <a />;",
        "class Unused { render() { return <a />; } }",
        "const first = <a />; const second = [first];",
        "function one() { return [two, <a />]; } function two() { return one(); }",
        "function view() { return <a />; } type Made = ReturnType<typeof view>;",
    ];
    let kept = [
        "console.log(<a />);",
        "{ const unused = <a />; }",
        "export const shown = <a />;",
        "const shown = <a />; export { shown as other };",
        "export default <a />;",
        "const unused = <a>{console.log(1)}</a>;",
        "const first = <a />; const second = [first]; console.log(second);",
        "function view() { return <a />; } console.log(typeof view);",
        "function view() { return <a />; } function outer() { function inner() { return view(); } } outer();",
        "class Shown { render() { return <a />; } } console.log(new Shown());",
        "class Unused { static { console.log(1); } render() { return <a />; } }",
        "class Unused { [(console.log(1), 'render')]() { return <a />; } }",
        "const unused = <a />; eval('unused');",
    ];
    for main in dropped {
        assert!(!runs_runtime_of_elements(main), "{main}");
    }
    for main in kept {
        assert!(runs_runtime_of_elements(main), "{main}");
    }
}

const QUIET_PACKAGE: (&str, &str) = (
    "node_modules/lib/package.json",
    r#"{ "name": "lib", "version": "1.0.0", "sideEffects": false }"#,
);
const GETTER_OVER_ES_MODULE: &str = "var dep_1 = require('./h2.mjs');\n\
    Object.defineProperty(exports, 'x', { enumerable: true, get: function () { return dep_1.x; } });";
const GETTER_OVER_OWNER: &str = "var dep_1 = require('./owner.cjs');\n\
    Object.defineProperty(exports, 'x', { enumerable: true, get: function () { return dep_1.x; } });";

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

const NAME_OF_A_CLASS_BEHIND_A_REMOVED_IMPORT: [(&str, &str); 7] = [
    ("main.mjs", "import './page.mjs';"),
    (
        "page.mjs",
        "import { C } from './p/index.mjs'; console.log(C); const m = await import('./p/b.mjs'); console.log(m);",
    ),
    ("p/package.json", r#"{ "name": "p", "sideEffects": false }"#),
    (
        "p/index.mjs",
        "export * from './c2.mjs'; export * from './b.mjs';",
    ),
    ("p/c2.mjs", "export const C = 1;"),
    ("p/b.mjs", "export { K1 } from './c.cjs';"),
    ("p/c.cjs", "exports.K1 = class {};"),
];

fn describe_checks(
    files: &[(&str, &str)],
    checks_what_is_written: bool,
) -> (Vec<String>, Option<(String, String)>) {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let Ok(mut bound) = build.bind_modules(loaded) else {
            panic!("the modules were not bound");
        };
        let graph = &mut bound.projects.application.graph;
        if checks_what_is_written {
            graph.check_every_written_importer();
        }
        let files = loaded.project(ProjectId::Application).loaded.files();
        let name_of = |file: FileId| {
            let name = files.module(file).file_name();
            name.strip_prefix(b"/project/")
                .unwrap_or(name)
                .as_bstr()
                .to_string()
        };
        let roots = graph.prefix_roots().iter();
        let roots = roots.filter(|&&root| !graph.checks_of(root).is_empty());
        let found = graph.find_check_of_copy_that_nothing_stores();
        let found = found.map(|(root, owner)| match owner {
            ModuleRef::File(owner) => (name_of(root), name_of(owner)),
            _ => panic!("a file has the name"),
        });
        (roots.map(|&root| name_of(root)).collect(), found)
    })
}

#[test]
fn root_does_not_check_an_importer_behind_an_import_that_is_removed() {
    let files = &NAME_OF_A_CLASS_BEHIND_A_REMOVED_IMPORT;
    assert_eq!(
        describe_checks(files, false),
        (vec!["p/b.mjs".to_string()], None)
    );
}

#[test]
fn root_does_not_check_a_name_that_it_takes_through_a_file_that_is_left_out() {
    let mut files = NAME_OF_A_CLASS_BEHIND_A_REMOVED_IMPORT.to_vec();
    files[1].1 = "import { C, K1 } from './p/index.mjs'; console.log(C); const m = await import('./p/b.mjs'); console.log(m);";
    files[3].1 = "export { C } from './c2.mjs'; export { K1 } from './a2.mjs';";
    files.push(("p/a2.mjs", "export { K1 } from './b.mjs';"));
    assert_eq!(
        describe_checks(&files, false),
        (vec!["p/b.mjs".to_string()], None)
    );
    let names = ("main.mjs".to_string(), "p/c.cjs".to_string());
    assert_eq!(describe_checks(&files, true).1, Some(names));
}

#[test]
fn check_of_a_copy_that_nothing_stores_is_found() {
    let (roots, found) = describe_checks(&NAME_OF_A_CLASS_BEHIND_A_REMOVED_IMPORT, true);
    assert_eq!(roots, ["main.mjs", "p/b.mjs"]);
    let names = ("main.mjs".to_string(), "p/c.cjs".to_string());
    assert_eq!(found, Some(names));
}

fn describe_imports(files: &[(&str, &str)]) -> Vec<String> {
    with_loaded_build(files, &default_settings(), |build, loaded| {
        let Ok(bound) = build.bind_modules(loaded) else {
            panic!("the modules were not bound");
        };
        let graph = &bound.projects.application.graph;
        let files = loaded.project(ProjectId::Application).loaded.files();
        let name_of = |file: FileId| {
            let name = files.module(file).file_name();
            name.strip_prefix(b"/project/")
                .unwrap_or(name)
                .as_bstr()
                .to_string()
        };
        let mut lines = Vec::new();
        for &file in graph.record_files() {
            let imports = graph.requests(file).iter();
            let imports = imports.filter(|it| it.kind == ModuleRequestKind::Import);
            let names: Vec<String> = imports
                .filter_map(|it| match it.target {
                    ModuleRef::File(target) => Some(name_of(target)),
                    _ => None,
                })
                .collect();
            if !names.is_empty() {
                lines.push(format!("{}: {}", name_of(file), names.join(" ")));
            }
        }
        lines.sort_unstable();
        lines
    })
}

const UNREAD_NAME_OF_AN_INDEX: [(&str, &str); 5] = [
    ("main.mjs", "import './page.mjs';"),
    (
        "page.mjs",
        "import { w } from './p/index.mjs'; const m = await import('./p/index.mjs'); console.log(m.z);",
    ),
    ("p/package.json", r#"{ "name": "p", "sideEffects": false }"#),
    (
        "p/index.mjs",
        "export * from './owner.cjs'; export { w } from './owner.cjs';",
    ),
    ("p/owner.cjs", "module.exports = { w: 1, z: 2 };"),
];

#[test]
fn unread_import_stays_where_the_link_looks_its_name_up() {
    assert_eq!(
        describe_imports(&UNREAD_NAME_OF_AN_INDEX),
        [
            "main.mjs: page.mjs",
            "p/index.mjs: p/owner.cjs",
            "page.mjs: p/index.mjs"
        ]
    );
}

#[test]
fn unread_import_goes_where_its_name_is_bound() {
    let mut files = UNREAD_NAME_OF_AN_INDEX;
    files[3].1 = "export const w = 1; export const z = 2;";
    assert_eq!(describe_imports(&files[..4]), ["main.mjs: page.mjs"]);
}

#[test]
fn unread_import_of_an_entry_point_stays() {
    let mut files = UNREAD_NAME_OF_AN_INDEX;
    files[3].1 = "export const w = 1; export const z = 2;";
    files[1].0 = "main.mjs";
    assert_eq!(describe_imports(&files[1..4]), ["main.mjs: p/index.mjs"]);
}

const UNREAD_NAME_OF_A_FILE_ON_A_CYCLE: [(&str, &str); 5] = [
    (
        "main.mjs",
        "import * as shelf from './shelf.mjs'; console.log(shelf.label);",
    ),
    (
        "shelf.mjs",
        "import crate from './crate.cjs'; import { tag } from './box.cjs'; export const label = typeof crate.later;",
    ),
    (
        "box.cjs",
        "const crate = require('./crate.cjs'); module.exports = { tag: 'box' };\n\
        module.exports.later = function () { return require('./shelf.mjs'); };",
    ),
    (
        "crate.cjs",
        "module.exports.later = function () { return require('./box.cjs'); };",
    ),
    ("package.json", r#"{ "name": "p", "sideEffects": false }"#),
];

#[test]
fn unread_import_stays_where_a_root_checks_its_name() {
    let files = UNREAD_NAME_OF_A_FILE_ON_A_CYCLE;
    assert_eq!(
        describe_imports(&files),
        ["main.mjs: shelf.mjs", "shelf.mjs: crate.cjs box.cjs"]
    );
    assert_eq!(describe_checks(&files, false).0, ["main.mjs", "shelf.mjs"]);
}

#[test]
fn unread_import_of_a_file_that_is_left_out_goes() {
    let mut files = UNREAD_NAME_OF_A_FILE_ON_A_CYCLE;
    files[3].1 = "module.exports.later = function () {};";
    assert_eq!(
        describe_imports(&files),
        ["main.mjs: shelf.mjs", "shelf.mjs: crate.cjs"]
    );
}
