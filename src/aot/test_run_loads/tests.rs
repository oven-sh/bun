use bstr::BStr;
use bun_ast::{Loader, Log};
use bun_sema::program::{FileId, Files};

use super::{LoadsOfRun, WhyEveryFile, warn_where_every_file_may_load_again};
use crate::builtins::table;
use crate::compile::testing::{
    BUNDLED_LIBS, TestProject, default_settings, describe_messages, run_build,
};
use crate::compile::{Build, LoadedBuild};
use crate::diagnostics::Diagnostics;
use crate::load::ProjectId;
use crate::load::source_provider::WithoutServices;
use crate::module_keys::{path_of_form, path_without_form};
use crate::modules::{ModuleGraph, ModuleRef};

fn test_run(files: &[(&str, &str)], test_file_count: usize) -> TestProject {
    let mut project = TestProject::with_entry_points(files, test_file_count, &default_settings());
    project.runs_tests = true;
    project
}

fn load<R>(
    project: &TestProject,
    then: impl FnOnce(&mut Build<'_>, &LoadedBuild<'_, '_>) -> R,
) -> R {
    run_build(project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|build, loaded| Ok(then(build, &loaded)))
    })
}

fn files_of<'l, 's>(loaded: &'l LoadedBuild<'_, 's>) -> &'l Files<'s> {
    loaded.project(ProjectId::Application).loaded.files()
}

fn with_graph_of<R>(project: &TestProject, then: impl FnOnce(&Files<'_>, &ModuleGraph) -> R) -> R {
    load(project, |build, loaded| {
        let Ok(bound) = build.bind_modules(loaded) else {
            panic!("the modules are not bound");
        };
        then(files_of(loaded), &bound.projects.application.graph)
    })
}

fn with_graph<R>(files: &[(&str, &str)], then: impl FnOnce(&Files<'_>, &ModuleGraph) -> R) -> R {
    with_graph_of(&test_run(files, 1), then)
}

fn file_named(files: &Files<'_>, name: &str) -> FileId {
    let file = files.by_path.get(format!("/project/{name}").as_bytes());
    file.unwrap_or_else(|| panic!("{name} is not in the program"))
}

fn name_of(files: &Files<'_>, file: FileId) -> String {
    let name = files.module(file).file_name();
    BStr::new(name.strip_prefix(b"/project/").unwrap_or(name)).to_string()
}

fn names_of(files: &Files<'_>, listed: &[FileId]) -> Vec<String> {
    let mut names: Vec<String> = listed.iter().map(|&file| name_of(files, file)).collect();
    names.sort();
    names
}

fn load_statement<R>(statement: &str, then: impl FnOnce(&LoadedBuild<'_, '_>) -> R) -> R {
    let test_file = "import { test } from \"bun:test\";\nimport \"./uses.cjs\";\nimport \"./a.cjs\";\ntest(\"t\", () => {});\n";
    let files = [
        ("a.test.js", test_file),
        ("uses.cjs", statement),
        ("a.cjs", "exports.a = 1;\n"),
    ];
    load(&test_run(&files, 1), |_, loaded| then(loaded))
}

fn describe_notices(
    loaded: &LoadedBuild<'_, '_>,
    loads: &LoadsOfRun,
    left_out: &[FileId],
) -> String {
    let view = loaded.project(ProjectId::Application).view();
    let mut diagnostics = Diagnostics::new();
    warn_where_every_file_may_load_again(&mut diagnostics, view, loads, left_out);
    let mut log = Log::init();
    diagnostics.write_to(&mut log);
    describe_messages(&log)
}

const HEAD_OF_CALLS: &str = r#"import { test } from "bun:test";
import {
  appendFileSync, copyFileSync, cpSync, createWriteStream, openSync, renameSync, rm, rmSync, symlinkSync, truncateSync, unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { one } from "./lib/one.js";
import { two } from "./lib/two.js";
const options = { recursive: process.argv.length > 0 };
"#;

fn find_files_changed_by(calls: &[String]) -> Vec<Vec<String>> {
    let folders = 0..calls.len();
    let test_files = calls.iter().zip(folders.clone()).map(|(call, folder)| {
        let text = format!(
            "{HEAD_OF_CALLS}test(\"it\", () => {{\n  if (process.argv.length > 99) {call};\n  console.log(one, two);\n}});\n"
        );
        (format!("c{folder}/case.test.js"), text)
    });
    let libraries = folders.flat_map(|folder| {
        [
            (
                format!("c{folder}/lib/one.js"),
                String::from("export const one = \"one\";\n"),
            ),
            (
                format!("c{folder}/lib/two.js"),
                String::from("export const two = \"two\";\n"),
            ),
        ]
    });
    let files: Vec<(String, String)> = test_files.chain(libraries).collect();
    let files: Vec<(&str, &str)> = (files.iter())
        .map(|(name, text)| (&name[..], &text[..]))
        .collect();
    load(&test_run(&files, calls.len()), |_, loaded| {
        let loads = &loaded.contents.run.loads;
        assert!(!loads.is_every_file);
        let changed = names_of(files_of(loaded), &loads.files_changed_on_disk);
        let of_folder = |folder: usize| -> Vec<String> {
            let prefix = format!("c{folder}/");
            let below = (changed.iter()).filter_map(|name| name.strip_prefix(&prefix[..]));
            below.map(String::from).collect()
        };
        (0..calls.len()).map(of_folder).collect()
    })
}

#[test]
fn call_that_fails_on_a_folder_changes_nothing_below_it() {
    const DIR: &str = "import.meta.dir";
    const LIB: &str = "join(import.meta.dir, \"lib\")";
    const NONE: &[&str] = &[];
    const ONE: &[&str] = &["lib/one.js"];
    const TWO: &[&str] = &["lib/two.js"];
    const ALL: &[&str] = &["lib/one.js", "lib/two.js"];
    let cases: Vec<(String, &[&str])> = vec![
        (format!("writeFileSync({DIR}, \"x\")"), NONE),
        (format!("appendFileSync({LIB}, \"x\")"), NONE),
        (format!("truncateSync({LIB})"), NONE),
        (format!("unlinkSync({LIB})"), NONE),
        (format!("createWriteStream({LIB})"), NONE),
        (format!("copyFileSync(\"other\", {LIB})"), NONE),
        (format!("symlinkSync(\"other\", {LIB})"), NONE),
        (format!("openSync({LIB}, \"w\")"), NONE),
        (format!("Bun.write({LIB}, \"x\")"), NONE),
        (format!("Bun.file({LIB}).delete()"), NONE),
        (format!("rmSync({LIB})"), NONE),
        (format!("rmSync({LIB}, {{ force: true }})"), NONE),
        (format!("rmSync({LIB}, {{ recursive: false }})"), NONE),
        (format!("rm({LIB}, () => {{}})"), NONE),
        (format!("cpSync(\"other\", {LIB})"), NONE),
        (
            format!("writeFileSync(join({LIB}, \"one.js\"), \"x\")"),
            ONE,
        ),
        (format!("rmSync(join({LIB}, \"two.js\"))"), TWO),
        (format!("rmSync({LIB}, {{ recursive: true }})"), ALL),
        (
            format!("rmSync({LIB}, {{ force: true, recursive: process.argv.length > 0 }})"),
            ALL,
        ),
        (format!("rmSync({LIB}, options)"), ALL),
        (format!("rmSync({LIB}, {{ ...options }})"), ALL),
        (format!("rm({LIB}, {{ recursive: true }}, () => {{}})"), ALL),
        (
            format!("cpSync(\"other\", {LIB}, {{ recursive: true }})"),
            ALL,
        ),
        (format!("renameSync({LIB}, \"other\")"), ALL),
        (format!("renameSync(\"other\", {LIB})"), ALL),
    ];
    let calls: Vec<String> = cases.iter().map(|case| case.0.clone()).collect();
    for ((call, expected), changed) in cases.iter().zip(find_files_changed_by(&calls)) {
        assert_eq!(changed, *expected, "{call}");
    }
    for call in [
        "createWriteStream(\"\", { fd: 1 })",
        "rmSync(\"\", { recursive: true })",
    ] {
        let changed = find_files_changed_by(&[String::from(call)]);
        assert_eq!(changed, [NONE], "{call}");
    }
}

#[test]
fn path_that_is_spelled_in_part_marks_the_files_that_fit() {
    let changes: [(&str, &[&str]); 4] = [
        (
            r#"writeFileSync(import.meta.dir + "/lib/" + process.argv[2] + ".js", "")"#,
            &["lib/one.js", "lib/two.js"],
        ),
        (
            r#"writeFileSync(import.meta.dir + "/lib/t" + process.argv[2] + ".js", "")"#,
            &["lib/two.js"],
        ),
        (
            r#"writeFileSync(import.meta.dir + "/lib/" + process.argv[2] + ".txt", "")"#,
            &[],
        ),
        (r#"writeFileSync(process.argv[2], "")"#, &[]),
    ];
    let calls: Vec<String> = changes.iter().map(|it| String::from(it.0)).collect();
    for ((call, expected), changed) in changes.iter().zip(find_files_changed_by(&calls)) {
        assert_eq!(changed, *expected, "{call}");
    }
}

#[test]
fn file_leaves_by_its_key() {
    let uses: [(&str, &[&str], bool); 14] = [
        (
            r#"delete require.cache[require.resolve("./a.cjs")];"#,
            &["a.cjs"],
            false,
        ),
        (
            r#"const path = require.resolve("./a.cjs"); const key = path; delete require.cache[key];"#,
            &["a.cjs"],
            false,
        ),
        (
            r#"delete require.cache["/project/a.cjs"];"#,
            &["a.cjs"],
            false,
        ),
        (
            r#"require.cache[require.resolve("./a.cjs")] = undefined;"#,
            &["a.cjs"],
            false,
        ),
        (
            r#"Reflect.deleteProperty(require.cache, require.resolve("./a.cjs"));"#,
            &["a.cjs"],
            false,
        ),
        (
            r#"const Module = require("node:module"); delete Module._cache[require.resolve("./a.cjs")];"#,
            &["a.cjs"],
            false,
        ),
        (r#"delete require.cache["/nowhere.js"];"#, &[], false),
        (
            r#"module.exports = require.cache[require.resolve("./a.cjs")];"#,
            &["a.cjs"],
            false,
        ),
        (
            r#"module.exports = require.cache[require.resolve("./a.cjs")].exports;"#,
            &[],
            false,
        ),
        (
            "exports.f = key => { const entry = require.cache[key]; return entry.exports; };",
            &[],
            false,
        ),
        (
            "exports.f = key => { const entry = require.cache[key]; delete entry.exports; };",
            &[],
            true,
        ),
        (
            r#"if (false) delete require.cache[require.resolve("./a.cjs")];"#,
            &[],
            false,
        ),
        ("delete require.cache[process.argv[2]];", &[], true),
        (
            "delete require.cache[require.resolve(process.argv[2])];",
            &[],
            true,
        ),
    ];
    for (statement, taken_out, is_every_file) in uses {
        load_statement(statement, |loaded| {
            let loads = &loaded.contents.run.loads;
            assert_eq!(loads.is_every_file, is_every_file, "{statement}");
            let found = names_of(files_of(loaded), &loads.files_taken_out);
            assert_eq!(found, taken_out, "{statement}");
            let reads_files = is_every_file || !taken_out.is_empty();
            assert_eq!(loads.reads_files_from_disk(), reads_files, "{statement}");
            assert_eq!(loaded.contents.any_module_loads_again, is_every_file);
        });
    }
}

#[test]
fn file_leaves_by_its_key_in_the_cache_of_an_imported_require() {
    let makers = [
        "import { createRequire } from \"node:module\";\nexport const load = createRequire(import.meta.url);\n",
        "export const load = require;\n",
    ];
    let test_file = "import { test } from \"bun:test\";\nimport \"./uses.mjs\";\nimport \"./a.cjs\";\ntest(\"t\", () => {});\n";
    let uses =
        "import { load } from \"./maker.mjs\";\ndelete load.cache[load.resolve(\"./a.cjs\")];\n";
    for maker in makers {
        let files = [
            ("a.test.js", test_file),
            ("uses.mjs", uses),
            ("maker.mjs", maker),
            ("a.cjs", "exports.a = 1;\n"),
        ];
        load(&test_run(&files, 1), |_, loaded| {
            let loads = &loaded.contents.run.loads;
            assert!(!loads.is_every_file, "{maker}");
            let found = names_of(files_of(loaded), &loads.files_taken_out);
            assert_eq!(found, ["a.cjs"], "{maker}");
        });
    }
}

#[test]
fn place_that_lets_every_file_load_again_is_named() {
    let doors: [(&str, WhyEveryFile, u32, &str); 5] = [
        (
            "\nBun.plugin({ name: \"p\", setup() {} });",
            WhyEveryFile::NamesPlugin,
            2,
            "This names Bun.plugin.",
        ),
        (
            "\n\nimport(\"./\" + process.argv[2] + \".cjs?again\");",
            WhyEveryFile::LoadsFileUnderQuery,
            3,
            "This loads a file under a query.",
        ),
        (
            "delete require.cache[process.argv[2]];",
            WhyEveryFile::TakesOutUnderUnknownKey,
            1,
            "This takes a module out of the table of loaded modules under a key that the build can't tell.",
        ),
        (
            "\n\n\nglobalThis.keep(require.cache);",
            WhyEveryFile::HandsTableOn,
            4,
            "This file hands the table of loaded modules on to code that may take anything out of it.",
        ),
        (
            "\nrequire.extensions[\".mine\"] = () => {};",
            WhyEveryFile::StoresLoader,
            2,
            "This file may store a loader for a kind of file.",
        ),
    ];
    for (statement, why, line, sentence) in doors {
        load_statement(statement, |loaded| {
            let (files, loads) = (files_of(loaded), &loaded.contents.run.loads);
            let whys: Vec<(String, WhyEveryFile)> = (loads.why_every_file.iter())
                .map(|&(file, why, _)| (name_of(files, file), why))
                .collect();
            assert_eq!(whys, [(String::from("uses.cjs"), why)], "{statement}");
            assert!(loads.is_every_file, "{statement}");
            let said = describe_notices(loaded, loads, &[]);
            assert!(said.contains(&format!("uses.cjs:{line}:")), "{said}");
            let whole = format!("{sentence} After that any file of this test run may load again");
            assert!(said.contains(&whole), "{said}");
            let left_out = [file_named(files, "uses.cjs")];
            assert_eq!(
                describe_notices(loaded, loads, &left_out),
                "",
                "{statement}"
            );
        });
    }
}

#[test]
fn query_behind_a_spelled_path_copies_that_file_alone() {
    for name in [
        "\"./a.cjs?again\"",
        "`./a.cjs?t=${Math.random()}`",
        "`./a?t=${Math.random()}`",
    ] {
        load_statement(&format!("import({name});"), |loaded| {
            let (files, loads) = (files_of(loaded), &loaded.contents.run.loads);
            assert_eq!(
                names_of(files, &loads.files_copied_under_queries),
                ["a.cjs"],
                "{name}"
            );
            assert!(
                loads.why_every_file.is_empty() && !loads.is_every_file,
                "{name}"
            );
            assert!(loads.files_taken_out.is_empty(), "{name}");
            assert!(loads.reads_files_from_disk(), "{name}");
        });
    }
    load_statement("import(`./missing.cjs?t=${Math.random()}`);", |loaded| {
        let loads = &loaded.contents.run.loads;
        let whys: Vec<WhyEveryFile> = loads.why_every_file.iter().map(|it| it.1).collect();
        assert_eq!(whys, [WhyEveryFile::LoadsFileUnderQuery]);
        assert!(loads.files_copied_under_queries.is_empty() && loads.is_every_file);
    });
}

#[test]
fn reset_of_the_modules_has_a_notice_of_its_own() {
    let test_file =
        "import { jest, test } from \"bun:test\";\ntest(\"t\", () => { jest.resetModules(); });\n";
    load(&test_run(&[("a.test.js", test_file)], 1), |_, loaded| {
        let loads = &loaded.contents.run.loads;
        let whys: Vec<WhyEveryFile> = loads.why_every_file.iter().map(|it| it.1).collect();
        assert_eq!(whys, [WhyEveryFile::ResetsModules]);
        assert!(loads.is_every_file);
        assert!(loads.library_modules_that_entries_may_answer.is_empty());
        assert_eq!(describe_notices(loaded, loads, &[]), "");
    });
}

fn find_modules_that_entries_may_answer(statement: &str) -> Vec<String> {
    load_statement(statement, |loaded| {
        let loads = &loaded.contents.run.loads;
        let modules = loads.library_modules_that_entries_may_answer.iter();
        let mut specifiers: Vec<String> = modules
            .map(|&module| BStr::new(table::specifier_of(module)).to_string())
            .collect();
        specifiers.sort();
        specifiers
    })
}

#[test]
fn key_that_is_put_together_may_be_the_name_of_any_library_module() {
    const NAME: &str = "const name = hex => Buffer.from(hex, \"hex\").toString();";
    let ways = [
        String::from(
            r#"require.cache[Buffer.from("75726c", "hex").toString()] = { exports: { parse: 1 } };"#,
        ),
        format!(r#"{NAME} Reflect.set(require.cache, name("75726c"), {{ exports: 1 }});"#),
        format!(r#"{NAME} Object.assign(require.cache, {{ [name("6f73")]: {{ exports: 1 }} }});"#),
        format!(
            r#"{NAME} Object.defineProperty(require.cache, name("6f73"), {{ value: {{ exports: 1 }} }});"#
        ),
        format!(
            r#"{NAME} const Module = require("node:module"); Module._cache[name("75726c")] = {{ exports: 1 }};"#
        ),
        format!(r#"{NAME} const table = require.cache; table[name("6f73")] = {{ exports: 1 }};"#),
        String::from(
            r#"const put = (table, key, entry) => { table[key] = entry; }; put(require.cache, "url", { exports: 1 });"#,
        ),
        String::from(
            r#"exports.stub = (name, exports) => { require.cache[require.resolve(name)] = { exports }; };"#,
        ),
    ];
    for statement in &ways {
        let modules = find_modules_that_entries_may_answer(statement);
        for specifier in ["node:url", "node:os", "node:events", "ws"] {
            let is_listed = modules.iter().any(|it| it == specifier);
            assert!(is_listed, "{statement}: {specifier}");
        }
        assert!(!modules.iter().any(|it| it == "bun"), "{statement}");
    }
}

#[test]
fn key_that_is_known_in_part_names_the_modules_that_fit() {
    let keys: [(&str, &str, &[&str]); 8] = [
        (
            r#"const key = ["u", "r", "l"].join("");"#,
            "",
            &["node:url"],
        ),
        (
            r#"let key; key = ["u", "rl"].join("");"#,
            "key = undefined;",
            &["node:url"],
        ),
        (
            r#"const key = "ur" + Buffer.from("6c", "hex");"#,
            "",
            &["node:url"],
        ),
        (
            r#"const key = require("node:path").join(process.env.SOME_FOLDER ?? "", process.platform, "addon.node");"#,
            "",
            &[],
        ),
        (r#"const key = "node:" + process.argv[2];"#, "", &[]),
        (r#"const key = require.resolve("os");"#, "", &["node:os"]),
        (r#"const key = "os";"#, "", &[]),
        (r#"const key = require.resolve("./a.cjs");"#, "", &[]),
    ];
    for (declared, cleared, expected) in keys {
        let statement = format!(
            "exports.store = () => {{ {declared} require.cache[key] = {{ exports: {{ parse: 1 }} }}; delete require.cache[key]; {cleared} }};"
        );
        let modules = find_modules_that_entries_may_answer(&statement);
        assert_eq!(modules, expected, "{declared}");
    }
}

#[test]
fn deletion_stores_no_entry() {
    for statement in [
        "delete require.cache[process.argv[2]];",
        "Reflect.deleteProperty(require.cache, process.argv[2]);",
        "module.exports = require.cache[process.argv[2]];",
    ] {
        let modules = find_modules_that_entries_may_answer(statement);
        assert!(modules.is_empty(), "{statement}: {modules:?}");
    }
}

const FILES_AROUND_STATE: [(&str, &str); 7] = [
    (
        "user.js",
        "import { bump } from \"./state.js\";\nexport const user = () => bump();\n",
    ),
    (
        "state.js",
        "import { base } from \"./barrel.js\";\nlet calls = base;\nexport const bump = () => ++calls;\n",
    ),
    ("barrel.js", "export { base } from \"./base.js\";\n"),
    (
        "base.js",
        "export const base = 0;\nexport const unread = 1;\n",
    ),
    (
        "other.js",
        "import { far } from \"./far.js\";\nexport const other = () => far;\n",
    ),
    (
        "far.js",
        "export const far = 1;\nexport const unread = 2;\n",
    ),
    (
        "late.js",
        "export const late = () => import(\"./state.js\");\n",
    ),
];

fn with_graph_around_state<R>(
    helper: (&str, &str),
    then: impl FnOnce(&Files<'_>, &ModuleGraph) -> R,
) -> R {
    let test_file = format!(
        "import {{ test }} from \"bun:test\";\nimport {{ user }} from \"./user.js\";\nimport {{ other }} from \"./other.js\";\nimport {{ late }} from \"./late.js\";\nimport \"./{}\";\ntest(\"t\", () => console.log(user(), other(), late()));\n",
        helper.0
    );
    let mut files = vec![("a.test.js", &test_file[..]), helper];
    files.extend(FILES_AROUND_STATE);
    with_graph(&files, then)
}

const TAKES_STATE_OUT: (&str, &str) = (
    "evicts.cjs",
    "exports.evict = () => { delete require.cache[require.resolve(\"./state.js\")]; };\n",
);

#[test]
fn file_that_is_taken_out_leaves_with_whoever_has_yet_to_bind_it() {
    with_graph_around_state(TAKES_STATE_OUT, |files, graph| {
        let module = |name: &str| ModuleRef::File(file_named(files, name));
        for name in ["state.js", "user.js", "a.test.js"] {
            assert!(graph.may_be_evicted(module(name)), "{name}");
            assert!(graph.may_be_reevaluated(file_named(files, name)), "{name}");
            assert!(graph.is_every_export_asked_for(module(name)), "{name}");
        }
        for name in ["barrel.js", "base.js", "other.js", "far.js", "late.js"] {
            assert!(!graph.may_be_evicted(module(name)), "{name}");
            assert!(!graph.may_be_reevaluated(file_named(files, name)), "{name}");
        }
        assert!(!graph.may_be_evicted(module("evicts.cjs")));
        for name in ["barrel.js", "base.js", "other.js", "late.js"] {
            assert!(graph.is_named_by_copies(module(name)), "{name}");
            assert!(graph.is_every_export_asked_for(module(name)), "{name}");
        }
        assert!(graph.is_named_by_copies(module("far.js")));
        assert!(graph.is_every_export_asked_for(module("far.js")));
        assert!(!graph.test_run().is_changed_on_disk_by_run.contains(&true));
    });
}

#[test]
fn original_beside_a_mock_names_what_the_mocked_file_imports() {
    let files = [
        (
            "a.test.js",
            "import { test, vi } from \"bun:test\";\nvi.mock(\"./confirm.js\", async importOriginal => ({ ...(await importOriginal()) }));\nimport confirm from \"./confirm.js\";\nimport { far } from \"./far.js\";\ntest(\"t\", () => console.log(confirm, far));\n",
        ),
        (
            "confirm.js",
            "import { create } from \"./core.js\";\nexport default create(\"confirm\");\n",
        ),
        ("core.js", "export { create } from \"./lib/create.js\";\n"),
        (
            "lib/create.js",
            "export const create = name => name;\nexport const unread = 1;\n",
        ),
        (
            "far.js",
            "export const far = 1;\nexport const unread = 2;\n",
        ),
    ];
    with_graph(&files, |files, graph| {
        let module = |name: &str| ModuleRef::File(file_named(files, name));
        for name in ["core.js", "lib/create.js"] {
            assert!(graph.is_named_by_copies(module(name)), "{name}");
            assert!(graph.is_every_export_asked_for(module(name)), "{name}");
        }
        assert!(!graph.is_every_export_asked_for(module("far.js")));
        for &file in files.compiled_files() {
            let name = name_of(files, file);
            assert!(!graph.may_be_evicted(ModuleRef::File(file)), "{name}");
        }
    });
}

#[test]
fn file_that_the_test_runner_is_asked_for_names_what_it_imports() {
    let files = [
        (
            "a.test.js",
            "import { test, vi } from \"bun:test\";\ntest(\"t\", async () => {\n  await import(\"./state.js\");\n  vi.doMock(\"./state.js\", async () => ({ x: (await vi.importActual(\"./asked.js\")).sees() }));\n  await import(\"./state.js\");\n  await import(\"./far.js\");\n});\n",
        ),
        ("state.js", "export const x = 1;\n"),
        (
            "asked.js",
            "import { through } from \"./between.js\";\nexport const sees = () => through();\n",
        ),
        (
            "between.js",
            "import \"./state.js\";\nexport * from \"./handed-on.js\";\n",
        ),
        (
            "handed-on.js",
            "export const through = () => 1;\nexport const unread = 1;\n",
        ),
        (
            "far.js",
            "export const far = 1;\nexport const unread = 2;\n",
        ),
    ];
    with_graph(&files, |files, graph| {
        let module = |name: &str| ModuleRef::File(file_named(files, name));
        for name in ["between.js", "handed-on.js"] {
            assert!(graph.is_named_by_copies(module(name)), "{name}");
            assert!(graph.is_every_export_asked_for(module(name)), "{name}");
        }
        assert!(!graph.is_every_export_asked_for(module("far.js")));
    });
}

#[test]
fn run_that_takes_nothing_out_marks_no_file() {
    let helper = ("evicts.cjs", "exports.evict = () => {};\n");
    with_graph_around_state(helper, |files, graph| {
        for &file in files.compiled_files() {
            let (module, name) = (ModuleRef::File(file), name_of(files, file));
            assert!(!graph.may_be_evicted(module), "{name}");
            assert!(!graph.is_named_by_copies(module), "{name}");
        }
    });
}

#[test]
fn key_that_nobody_reads_takes_every_file_out() {
    let helper = (
        "evicts.cjs",
        "exports.evict = key => { delete require.cache[key]; };\n",
    );
    with_graph_around_state(helper, |files, graph| {
        for name in ["state.js", "far.js", "a.test.js", "evicts.cjs"] {
            let module = ModuleRef::File(file_named(files, name));
            assert!(graph.may_be_evicted(module), "{name}");
        }
    });
}

#[test]
fn key_behind_a_test_of_its_start_takes_out_what_lies_below() {
    let test_file = "import { test } from \"bun:test\";\nimport \"./uses.cjs\";\nimport \"./lib/a.cjs\";\nimport \"./lib/deep/b.cjs\";\nimport \"./other/c.cjs\";\ntest(\"t\", () => {});\n";
    let head = "const { dirname, sep } = require(\"node:path\");\n";
    let with_uses = |uses: &str, then: &dyn Fn(&Files<'_>, &LoadsOfRun)| {
        let uses = format!("{head}{uses}");
        let files = [
            ("a.test.js", test_file),
            ("uses.cjs", &uses[..]),
            ("lib/a.cjs", "exports.a = 1;\n"),
            ("lib/deep/b.cjs", "exports.b = 1;\n"),
            ("other/c.cjs", "exports.c = 1;\n"),
        ];
        load(&test_run(&files, 1), |_, loaded| {
            then(files_of(loaded), &loaded.contents.run.loads)
        });
    };
    let spelled = [
        "const folder = dirname(require.resolve(\"./lib/a.cjs\")) + sep;\nfor (const key of Object.keys(require.cache)) { if (key.startsWith(folder) && !key.endsWith(\"x\")) { delete require.cache[key]; } }\n",
        "for (const key of Object.keys(require.cache)) if (key.startsWith(dirname(require.resolve(\"./lib/a.cjs\")) + \"/\")) delete require.cache[key];\n",
        "Object.keys(require.cache).forEach(key => { if (key.startsWith(\"/project/lib/\")) delete require.cache[key]; });\n",
        "const cut = sep;\nconst folder = dirname(dirname(require.resolve(\"./lib/a.cjs\")) + cut + \"x\") + cut;\nfor (const key of Object.keys(require.cache)) { if (key.startsWith(folder)) { delete require.cache[key]; } }\n",
    ];
    for uses in spelled {
        with_uses(uses, &|files, loads| {
            assert_eq!(
                names_of(files, &loads.files_taken_out),
                ["lib/a.cjs", "lib/deep/b.cjs"],
                "{uses}"
            );
            assert!(
                loads.why_every_file.is_empty() && !loads.is_every_file,
                "{uses}"
            );
        });
    }
    let unread = [
        "const folder = dirname(require.resolve(\"./lib/a.cjs\")) + sep;\nfor (const key of Object.keys(require.cache)) { if (key.startsWith(folder)) {} else { delete require.cache[key]; } }\n",
        "const folder = dirname(require.resolve(\"./lib/a.cjs\")) + sep;\nfor (const key of Object.keys(require.cache)) { if (folder.startsWith(folder)) { delete require.cache[key]; } }\n",
        "for (const key of Object.keys(require.cache)) { if (key.startsWith(process.argv[2])) { delete require.cache[key]; } }\n",
        "const folder = dirname(require.resolve(\"./lib/a.cjs\")) + sep;\nfor (const key of Object.keys(require.cache)) { if (key.startsWith(folder) || key.length) { delete require.cache[key]; } }\n",
        "var above = below + sep;\nvar below = above + \"lib\";\nfor (const key of Object.keys(require.cache)) { if (key.startsWith(above)) { delete require.cache[key]; } }\n",
        "var above = dirname(below);\nvar below = dirname(above);\nfor (const key of Object.keys(require.cache)) { if (key.startsWith(above)) { delete require.cache[key]; } }\n",
        "var folder = folder + sep;\nfor (const key of Object.keys(require.cache)) { if (key.startsWith(folder)) { delete require.cache[key]; } }\n",
    ];
    for uses in unread {
        with_uses(uses, &|_, loads| {
            let whys: Vec<WhyEveryFile> = loads.why_every_file.iter().map(|it| it.1).collect();
            assert_eq!(whys, [WhyEveryFile::TakesOutUnderUnknownKey], "{uses}");
            assert!(loads.is_every_file && loads.is_any_file_taken_out, "{uses}");
        });
    }
}

#[test]
fn key_known_in_part_takes_out_the_files_that_fit() {
    let test_file = "import { test } from \"bun:test\";\nimport \"./uses.cjs\";\nimport \"./lib/a.cjs\";\nimport \"./other/a.cjs\";\nimport \"./other/c.cjs\";\ntest(\"t\", () => {});\n";
    let with_uses = |uses: &str, then: &dyn Fn(&Files<'_>, &LoadsOfRun)| {
        let uses = format!("const path = require(\"node:path\");\n{uses}");
        let files = [
            ("a.test.js", test_file),
            ("uses.cjs", &uses[..]),
            ("lib/a.cjs", "exports.a = 1;\n"),
            ("other/a.cjs", "exports.a = 2;\n"),
            ("other/c.cjs", "exports.c = 1;\n"),
        ];
        load(&test_run(&files, 1), |_, loaded| {
            then(files_of(loaded), &loaded.contents.run.loads)
        });
    };
    let known: [(&str, &[&str]); 6] = [
        (
            "exports.f = root => { delete require.cache[path.join(root, \"a.cjs\")]; };\n",
            &["lib/a.cjs", "other/a.cjs"],
        ),
        (
            "exports.f = root => { const key = path.join(root, process.platform, \"other\", \"c.cjs\"); delete require.cache[key]; };\n",
            &["other/c.cjs"],
        ),
        (
            "exports.f = root => { const key = path.join(root, process.platform, \"addon.node\"); require.cache[key] = { exports: 1 }; delete require.cache[key]; };\n",
            &[],
        ),
        (
            "exports.f = name => { delete require.cache[\"/project/lib/\" + name]; };\n",
            &["lib/a.cjs"],
        ),
        (
            "exports.f = name => { delete require.cache[path.join(__dirname, name, \"a.cjs\")]; };\n",
            &["lib/a.cjs", "other/a.cjs"],
        ),
        (
            "exports.f = name => { delete require.cache[__dirname + \"/other/\" + name]; };\n",
            &["other/a.cjs", "other/c.cjs"],
        ),
    ];
    for (uses, taken_out) in known {
        with_uses(uses, &|files, loads| {
            assert_eq!(names_of(files, &loads.files_taken_out), taken_out, "{uses}");
            assert!(
                loads.why_every_file.is_empty() && !loads.is_every_file,
                "{uses}"
            );
        });
    }
    with_uses(
        "exports.f = (root, name) => { delete require.cache[path.join(root, name)]; };\n",
        &|_, loads| {
            let whys: Vec<WhyEveryFile> = loads.why_every_file.iter().map(|it| it.1).collect();
            assert_eq!(whys, [WhyEveryFile::TakesOutUnderUnknownKey]);
            assert!(loads.is_every_file && loads.is_any_file_taken_out);
        },
    );
}

#[test]
fn text_that_comes_in_lets_no_body_run_again() {
    let helpers = [
        ("Bun.plugin({ name: \"p\", setup() {} });\n", false),
        ("require.extensions[\".mine\"] = () => {};\n", false),
        ("import(\"./\" + process.argv[2] + \".js?again\");\n", false),
        (
            "exports.evict = key => { delete require.cache[key]; };\n",
            true,
        ),
        ("globalThis.keep(require.cache);\n", true),
        (
            "Bun.plugin({ name: \"p\", setup() {} });\nglobalThis.keep(require.cache);\n",
            true,
        ),
    ];
    for (text, takes_out) in helpers {
        with_graph_around_state(("helper.cjs", text), |files, graph| {
            for name in ["state.js", "far.js", "a.test.js"] {
                let file = file_named(files, name);
                assert!(
                    graph.may_be_evicted(ModuleRef::File(file)),
                    "{name}: {text}"
                );
                assert_eq!(graph.may_be_reevaluated(file), takes_out, "{name}: {text}");
            }
        });
    }
}

#[test]
fn file_that_the_run_writes_leaves_and_its_new_text_names_any_file() {
    let helper = (
        "writes.js",
        "import { writeFileSync } from \"node:fs\";\nexport const write = () => writeFileSync(import.meta.dir + \"/state.js\", \"export const bump = () => 0;\");\n",
    );
    with_graph_around_state(helper, |files, graph| {
        let module = |name: &str| ModuleRef::File(file_named(files, name));
        for name in ["state.js", "user.js", "a.test.js"] {
            assert!(graph.may_be_evicted(module(name)), "{name}");
        }
        for name in ["base.js", "other.js", "far.js"] {
            assert!(!graph.may_be_evicted(module(name)), "{name}");
            assert!(graph.is_named_by_copies(module(name)), "{name}");
            assert!(graph.is_every_export_asked_for(module(name)), "{name}");
        }
        let changed = &graph.test_run().is_changed_on_disk_by_run;
        for &file in files.compiled_files() {
            let name = name_of(files, file);
            assert_eq!(changed[file.idx()], name == "state.js", "{name}");
        }
    });
}

#[test]
fn file_of_data_that_the_run_writes_names_nothing() {
    let test_file = "import { test } from \"bun:test\";\nimport { writeFileSync } from \"node:fs\";\nimport data from \"./data.json\";\nimport { far } from \"./far.js\";\ntest(\"t\", () => { writeFileSync(import.meta.dir + \"/data.json\", \"{}\"); console.log(data, far); });\n";
    let files = [
        ("a.test.js", test_file),
        ("data.json", "{ \"a\": 1 }\n"),
        (
            "far.js",
            "import { deep } from \"./deep.js\";\nexport const far = deep;\n",
        ),
        ("deep.js", "export const deep = 1;\n"),
    ];
    with_graph(&files, |files, graph| {
        let module = |name: &str| ModuleRef::File(file_named(files, name));
        assert!(graph.may_be_evicted(module("data.json")));
        assert!(!graph.may_be_evicted(module("far.js")));
        assert!(graph.is_named_by_copies(module("deep.js")));
        assert!(!graph.test_run().is_changed_on_disk_by_run.contains(&true));
    });
}

#[test]
fn what_an_import_attribute_makes_of_a_file_is_listed_with_the_file() {
    let orders = [
        "import data from \"./data.json\";\nimport text from \"./data.json\" with { type: \"text\" };",
        "import text from \"./data.json\" with { type: \"text\" };\nimport data from \"./data.json\";",
    ];
    for statements in orders {
        let test_file = format!(
            "import {{ test }} from \"bun:test\";\nimport {{ writeFileSync }} from \"node:fs\";\n{statements}\ntest(\"t\", () => {{ writeFileSync(import.meta.dir + \"/data.json\", \"{{}}\"); console.log(data, text); }});\n"
        );
        let files = [
            ("a.test.js", &test_file[..]),
            ("data.json", "{ \"a\": 1 }\n"),
        ];
        load(&test_run(&files, 1), |_, loaded| {
            let changed = &loaded.contents.run.loads.files_changed_on_disk;
            let names = names_of(files_of(loaded), changed);
            assert_eq!(names, ["data.json", "data.json"], "{statements}");
        });
        with_graph(&files, |files, graph| {
            let at_path = files.compiled_files().iter();
            let at_path = at_path.filter(|&&file| name_of(files, file) == "data.json");
            let leaving = at_path.filter(|&&file| graph.may_be_evicted(ModuleRef::File(file)));
            assert_eq!(leaving.count(), 2, "{statements}");
        });
    }
}

#[test]
fn form_is_stamped_by_the_path_of_its_file() {
    let form = path_of_form(b"/project/data.json", Loader::Text);
    assert_eq!(path_without_form(&form), Some(&b"/project/data.json"[..]));
    assert_eq!(path_without_form(b"/project/data.json"), None);
}

#[test]
fn files_of_the_library_are_not_taken_for_files_of_the_run() {
    let test_file = "import { test } from \"bun:test\";\nimport { user } from \"./user.js\";\nimport \"./evicts.cjs\";\ntest(\"t\", () => console.log(user()));\n";
    let mut files = vec![("a.test.js", test_file), TAKES_STATE_OUT];
    files.extend(FILES_AROUND_STATE);
    load(&test_run(&files, 1), |build, loaded| {
        let Ok(bound) = build.bind_modules(loaded) else {
            panic!("the modules are not bound");
        };
        let graph = &bound.projects.runtime.graph;
        let library = loaded.project(ProjectId::Runtime).loaded.files();
        for &file in library.compiled_files() {
            assert!(!graph.may_be_evicted(ModuleRef::File(file)));
            assert!(!graph.is_named_by_copies(ModuleRef::File(file)));
        }
    });
}
