use bun_sema::program::{FileId, Files, Sym};

use super::texts::ends_with_module_in_text;
use super::{RunContents, WhoseFile, flags_of_module};
use crate::builtins::BuiltinId;
use crate::compile::testing::{BUNDLED_LIBS, TestProject, default_settings, run_build};
use crate::ir::generated::ModuleFlags;
use crate::load::ProjectId;
use crate::load::source_provider::WithoutServices;
use crate::load::sources::parsed_source;
use crate::modules::{ModuleGraph, ModuleRef};

/// `bun test --aot`: the first `entry_points` files are what the runner starts, the last `preloads` of them as preloads.
/// A file that nothing loads lies on disk all the same.
fn project_of_run(files: &[(&str, &str)], (entry_points, preloads): (usize, usize)) -> TestProject {
    let mut project = TestProject::with_entry_points(files, entry_points, &default_settings());
    project.runs_tests = true;
    project.preload_count = preloads;
    project.aot.loads_code_from_disk = true;
    project.aot.only_tests_load_code_from_disk = true;
    project
}

fn with_run<R>(
    files: &[(&str, &str)],
    listed: (usize, usize),
    then: impl FnOnce(&Files<'_>, &RunContents) -> R,
) -> R {
    let project = project_of_run(files, listed);
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|_, loaded| {
            let files = loaded.project(ProjectId::Application).loaded.files();
            Ok(then(files, &loaded.contents.run))
        })
    })
}

/// The same run, bound.
fn with_bound_run<R>(
    files: &[(&str, &str)],
    listed: (usize, usize),
    then: impl FnOnce(&Files<'_>, &ModuleGraph) -> R,
) -> R {
    let project = project_of_run(files, listed);
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|build, loaded| {
            let bound = build.bind_modules(&loaded)?;
            let files = loaded.project(ProjectId::Application).loaded.files();
            let graph = &bound.projects.get(ProjectId::Application).graph;
            Ok(then(files, graph))
        })
    })
}

fn file_at(files: &Files<'_>, name: &str) -> FileId {
    let file = files.by_path.get(format!("/project/{name}").as_bytes());
    file.unwrap_or_else(|| panic!("{name} is in the program"))
}

fn whose(files: &Files<'_>, run: &RunContents, name: &str) -> WhoseFile {
    run.whose[file_at(files, name).idx()]
}

/// Whether a test may replace what the file exports under the name.
fn is_replaceable(files: &Files<'_>, graph: &ModuleGraph, file: &str, name: &str) -> bool {
    let file = file_at(files, file);
    let bound = files.bound(file);
    let exports = bound.symbol(bound.file_symbol).exports;
    let id = bound.lookup(exports, files.atoms.intern(name.as_bytes()));
    let id = id.expect("the file exports the name");
    graph.is_replaceable(Sym { file, id })
}

fn texts_of(files: &Files<'_>, texts: &[bun_sema::atom::Atom]) -> Vec<String> {
    let texts = texts.iter().map(|&text| files.atoms.bytes(text));
    texts
        .map(|text| String::from_utf8_lossy(text).into_owned())
        .collect()
}

const MANIFEST: (&str, &str) = ("package.json", r#"{ "name": "project", "type": "module" }"#);

// No name and no folder here says what the runner starts.
const PROJECT: [(&str, &str); 12] = [
    (
        "checks/latest.ts",
        "import { test } from 'bun:test';\nimport { help } from '../shared/help';\nimport { app } from '../src/app';\nimport { stub } from '../src/stubs';\nimport 'tool';\ntest('a', () => { help(); app(); stub(); });\n",
    ),
    ("boot.ts", "import './patch';\n"),
    ("patch.ts", "export {};\n"),
    ("shared/help.ts", "export const help = () => 1;\n"),
    (
        "src/app.ts",
        "import { lib } from './lib';\nimport 'dep';\nexport const app = () => lib();\n",
    ),
    ("src/lib.ts", "export const lib = () => 1;\n"),
    (
        "src/stubs.ts",
        "import { mock } from 'bun:test';\nexport const stub = mock(() => 1);\n",
    ),
    (
        "node_modules/dep/package.json",
        r#"{ "name": "dep", "version": "1.0.0", "main": "index.js" }"#,
    ),
    ("node_modules/dep/index.js", "exports.dep = 1;\n"),
    (
        "node_modules/tool/package.json",
        r#"{ "name": "tool", "version": "1.0.0", "main": "index.js" }"#,
    ),
    ("node_modules/tool/index.js", "exports.tool = 1;\n"),
    MANIFEST,
];

#[test]
fn the_list_of_the_runner_and_the_imports_say_whose_a_file_is() {
    let mut files = PROJECT.to_vec();
    files.push((
        "src/main.ts",
        "import { app } from './app';\nimport './stubs';\napp();\n",
    ));
    with_run(&files, (2, 1), |files, run| {
        let rows = [
            ("checks/latest.ts", WhoseFile::OfTests),
            ("boot.ts", WhoseFile::OfTests),
            ("patch.ts", WhoseFile::OfTests),
            ("shared/help.ts", WhoseFile::OfTests),
            ("src/stubs.ts", WhoseFile::OfTests),
            ("src/app.ts", WhoseFile::OfProduct),
            ("src/lib.ts", WhoseFile::OfProduct),
            ("node_modules/dep/index.js", WhoseFile::OfProduct),
            ("node_modules/tool/index.js", WhoseFile::OfNeither),
        ];
        for (name, expected) in rows {
            assert_eq!(whose(files, run, name), expected, "{name}");
        }
        let plan = run.plan_of_files();
        for (name, expected) in rows {
            let file = files.by_path.get(format!("/project/{name}").as_bytes());
            let index = file.unwrap().idx();
            let is_of_product = expected == WhoseFile::OfProduct;
            assert_eq!(
                plan.finds_builtins_read_only[index], is_of_product,
                "{name}"
            );
            let is_of_tests = expected == WhoseFile::OfTests;
            assert_eq!(
                plan.loads_compiled_files_alone[index], !is_of_tests,
                "{name}"
            );
        }
    });
}

#[test]
fn a_file_that_the_runner_starts_is_of_the_tests_whoever_else_imports_it() {
    let files = [
        (
            "checks/plain.ts",
            "import { app } from '../src/app';\napp();\n",
        ),
        ("src/app.ts", "export const app = () => 1;\n"),
        (
            "src/main.ts",
            "import './app';\nimport '../checks/plain';\n",
        ),
        MANIFEST,
    ];
    with_run(&files, (1, 0), |files, run| {
        assert_eq!(whose(files, run, "checks/plain.ts"), WhoseFile::OfTests);
        assert_eq!(whose(files, run, "src/app.ts"), WhoseFile::OfProduct);
    });
}

#[test]
fn what_the_preloads_alone_load_is_of_the_tests_however_deep() {
    let files = [
        (
            "a.test.ts",
            "import { test } from 'bun:test';\nimport { shared } from './shared';\ntest('a', () => { shared(); });\n",
        ),
        ("boot.ts", "import './patch';\n"),
        ("patch.ts", "import './deeper';\nimport './shared';\n"),
        ("deeper.ts", "export {};\n"),
        (
            "shared.ts",
            "import './below';\nexport const shared = () => 1;\n",
        ),
        ("below.ts", "export {};\n"),
        MANIFEST,
    ];
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "deeper.ts"), WhoseFile::OfTests);
        // A test file reaches it too, two steps away, and it asks for nothing.
        assert_eq!(whose(files, run, "below.ts"), WhoseFile::OfProduct);
    });
    let mut files = files.to_vec();
    files.push(("main.ts", "import { shared } from './shared';\nshared();\n"));
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "deeper.ts"), WhoseFile::OfTests);
        assert_eq!(whose(files, run, "shared.ts"), WhoseFile::OfProduct);
        assert_eq!(whose(files, run, "below.ts"), WhoseFile::OfProduct);
    });
}

#[test]
fn of_what_lies_deeper_than_a_step_only_a_file_that_asks_for_it_is_the_tests() {
    with_run(&PROJECT, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "src/app.ts"), WhoseFile::OfTests);
        assert_eq!(whose(files, run, "src/lib.ts"), WhoseFile::OfProduct);
    });
    let asking = [
        "export const lib = (path: string) => import(path);\n",
        "export const lib = (name: string) => require(name);\n",
        "Date.now = () => 1;\nexport const lib = () => 1;\n",
        "export const lib = () => new Function(String(globalThis.text))();\n",
    ];
    for text in asking {
        let mut files = PROJECT.to_vec();
        files.retain(|file| !matches!(file.0, "src/lib.ts"));
        // Three steps from the test file, behind a file that asks for nothing.
        files.extend([
            ("src/lib.ts", "export { lib } from './deep';\n"),
            ("src/deep.ts", text),
        ]);
        with_run(&files, (2, 1), |files, run| {
            assert_eq!(
                whose(files, run, "src/lib.ts"),
                WhoseFile::OfProduct,
                "{text}"
            );
            assert_eq!(
                whose(files, run, "src/deep.ts"),
                WhoseFile::OfTests,
                "{text}"
            );
        });
        // The product comes to it too.
        files.push(("src/main.ts", "import { lib } from './deep';\nlib('');\n"));
        with_run(&files, (2, 1), |files, run| {
            assert_eq!(
                whose(files, run, "src/deep.ts"),
                WhoseFile::OfProduct,
                "{text}"
            );
        });
    }
}

#[test]
fn a_text_that_a_deeper_file_holds_takes_it_to_no_side() {
    let mut files = PROJECT.to_vec();
    files.retain(|file| !matches!(file.0, "src/lib.ts"));
    files.extend([
        ("src/lib.ts", "export { lib } from './deep';\n"),
        ("src/deep.ts", "export const MOD = `globalThis.ArrayBuffer = function () {}; Date.now = () => 1;`;\nexport const lib = () => MOD;\n"),
    ]);
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "src/deep.ts"), WhoseFile::OfProduct);
    });
}

#[test]
fn a_file_that_gives_an_imported_function_a_value_that_nobody_reads_asks_for_nothing_unless_the_function_loads()
 {
    let deep =
        "import { take } from './taker';\nexport const lib = (name: string) => take(name);\n";
    for (taker, side) in [
        (
            "export const take = (name: string) => name.length;\n",
            WhoseFile::OfProduct,
        ),
        ("export const take = require;\n", WhoseFile::OfTests),
    ] {
        let mut files = PROJECT.to_vec();
        files.retain(|file| !matches!(file.0, "src/lib.ts"));
        files.extend([
            ("src/lib.ts", "export { lib } from './deep';\n"),
            ("src/deep.ts", deep),
            ("src/taker.ts", taker),
        ]);
        with_run(&files, (2, 1), |files, run| {
            assert_eq!(
                whose(files, run, "src/lib.ts"),
                WhoseFile::OfProduct,
                "{taker}"
            );
            assert_eq!(whose(files, run, "src/deep.ts"), side, "{taker}");
        });
    }
}

#[test]
fn a_ring_of_imports_that_the_tests_enter_stays_the_products_with_what_it_imports() {
    let mut files = PROJECT.to_vec();
    files.retain(|file| !matches!(file.0, "src/app.ts" | "src/lib.ts"));
    files.extend([
        ("src/app.ts", "import { lib } from './lib';\nimport 'dep';\nexport const app = () => lib();\n"),
        ("src/lib.ts", "import { app } from './app';\nimport { leaf } from './leaf';\nexport const lib = () => leaf(app);\n"),
        ("src/leaf.ts", "export const leaf = (it: unknown) => typeof it;\n"),
    ]);
    with_run(&files, (2, 1), |files, run| {
        for name in ["src/app.ts", "src/lib.ts", "src/leaf.ts"] {
            assert_eq!(whose(files, run, name), WhoseFile::OfProduct, "{name}");
        }
        assert_eq!(whose(files, run, "shared/help.ts"), WhoseFile::OfTests);
    });
}

#[test]
fn a_fixture_on_disk_that_only_test_files_import_makes_no_helper_the_products() {
    let fixture = (
        "fixtures/made.ts",
        "import { help } from '../shared/help';\nexport const made = () => help();\n",
    );
    let outer = (
        "fixtures/outer.ts",
        "import { made } from './made';\nexport const outer = () => made();\n",
    );
    let other = (
        "checks/other.ts",
        "import { test } from 'bun:test';\nimport { outer } from '../fixtures/outer';\ntest('b', () => { outer(); });\n",
    );
    let mut files = PROJECT.to_vec();
    files.extend([fixture, outer, other]);
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "shared/help.ts"), WhoseFile::OfTests);
    });
    // The product imports the outer fixture too.
    files.push((
        "src/main.ts",
        "import { outer } from '../fixtures/outer';\nouter();\n",
    ));
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "shared/help.ts"), WhoseFile::OfProduct);
    });
}

#[test]
fn a_file_that_a_manifest_names_as_a_way_in_is_the_products() {
    let mut files = PROJECT.to_vec();
    files.retain(|file| file.0 != MANIFEST.0);
    files.push((
        MANIFEST.0,
        r#"{ "name": "project", "type": "module", "main": "./src/app.ts" }"#,
    ));
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "src/app.ts"), WhoseFile::OfProduct);
    });
}

#[test]
fn a_file_on_disk_that_only_exports_a_helper_again_takes_nothing_for_itself() {
    let again = ("shared/index.ts", "export { help } from './help';\n");
    let mut files = PROJECT.to_vec();
    files.push(again);
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "shared/help.ts"), WhoseFile::OfTests);
    });
    files.push((
        "src/main.ts",
        "import { help } from '../shared';\nhelp();\n",
    ));
    with_run(&files, (2, 1), |files, run| {
        assert_eq!(whose(files, run, "shared/help.ts"), WhoseFile::OfProduct);
    });
}

#[test]
fn a_test_file_on_disk_that_the_run_leaves_out_makes_no_helper_the_products() {
    for other in [
        "import { test } from 'bun:test';\nimport { help } from '../shared/help';\ntest('b', () => { help(); });\n",
        "import { help } from '../shared/help';\ntest('b', () => { expect(help()).toBe(1); });\n",
    ] {
        let mut files = PROJECT.to_vec();
        files.push(("checks/other.ts", other));
        with_run(&files, (2, 1), |files, run| {
            assert_eq!(
                whose(files, run, "shared/help.ts"),
                WhoseFile::OfTests,
                "{other}"
            );
        });
    }
}

const LOADER: &str = "node_modules/tool/lib/transform.js";
const TOOL: [(&str, &str); 3] = [
    (
        "node_modules/tool/package.json",
        r#"{ "name": "tool", "version": "1.0.0", "main": "index.js" }"#,
    ),
    (
        "node_modules/tool/index.js",
        "'use strict';\nmodule.exports = require('./lib/transform.js');\n",
    ),
    (
        LOADER,
        "'use strict';\nexports.transform = (text, plugins) => plugins.reduce((it, name) => require(name)(it), text);\n",
    ),
];

/// Whether the file of the package that writes `require(name)` may load code from disk. `product`: src/product.ts, which src/main.ts imports.
fn tool_may_load(manifest: &str, product: &str) -> bool {
    let mut files = vec![
        (
            "tests/tool.test.ts",
            "import { test } from 'bun:test';\nimport { transform } from 'tool';\nimport { name } from '../src/product';\ntest(name, () => { transform('a', ['plugin']); });\n",
        ),
        ("package.json", manifest),
        ("src/product.ts", product),
        ("src/main.ts", "import './product';\n"),
    ];
    files.extend(TOOL);
    with_run(&files, (1, 0), |files, run| {
        let may_load = |name: &str| {
            let file = files.by_path.get(format!("/project/{name}").as_bytes());
            !run.loads_compiled_files_alone[file.unwrap().idx()]
        };
        // Nothing else of the package asks to leave, and it stays as it is.
        assert!(!may_load("node_modules/tool/index.js"));
        may_load(LOADER)
    })
}

#[test]
fn a_package_that_only_the_tests_reach_loads_by_a_computed_name() {
    let product = "export const name: string = 'product';\n";
    assert!(tool_may_load(MANIFEST.1, product));
    assert!(!tool_may_load(
        MANIFEST.1,
        "import 'tool';\nexport const name: string = 'product';\n"
    ));
    let manifest = |fields: &str| format!(r#"{{ "name": "project", "type": "module", {fields} }}"#);
    assert!(!tool_may_load(
        &manifest(r#""dependencies": { "tool": "1.0.0" }"#),
        product
    ));
    assert!(!tool_may_load(
        &manifest(r#""optionalDependencies": { "tool": "1.0.0" }"#),
        product
    ));
    assert!(tool_may_load(
        &manifest(r#""devDependencies": { "tool": "1.0.0" }"#),
        product
    ));
}

/// What a test file with these statements leaves open: a spy under any name, a mock of any module.
fn left_open_by_test_file(statements: &str) -> (bool, bool) {
    let test_file = format!(
        "import {{ expect, spyOn, test }} from 'bun:test';\nimport * as lib from './src/lib';\ndeclare const made: () => string;\ndeclare const toolsOf: (...all: unknown[]) => any;\ntest('a', () => {{ {statements} }});\n"
    );
    let files = [
        ("a.test.ts", &test_file[..]),
        ("src/lib.ts", "export function total() { return 1; }\n"),
        ("src/main.ts", "import './lib';\n"),
        MANIFEST,
    ];
    with_run(&files, (1, 0), |_, run| {
        (run.spies_under_any_name, run.mocks_any_module)
    })
}

#[test]
fn what_only_leads_to_the_runner_opens_no_run() {
    for statements in [
        "toolsOf(Bun, import.meta.path).spyOn(lib, 'total');",
        "(Bun as any)[made()](import.meta.path).spyOn(lib, 'total');",
        "(globalThis as any)[made()].jest(import.meta.path).spyOn(lib, 'total');",
        "Reflect.get(Bun, 'jest')(import.meta.path).spyOn(lib, 'total');",
        "([Bun][0] as any).jest(import.meta.path).spyOn(lib, 'total');",
        "const held = { Bun }; toolsOf(held);",
        "Object.create(Bun).jest(import.meta.path).spyOn(lib, 'total');",
        "console.log(Bun.version, typeof Bun, lib.total());",
        "(globalThis as any).kept = 1;",
        "const { version } = Bun; console.log(version);",
        "if (Bun) console.log(Bun === (globalThis as any).Bun);",
        "spyOn(globalThis, 'fetch');",
        "spyOn(Bun, 'file');",
        "Object.defineProperty(globalThis, 'kept', { value: 1, configurable: true });",
    ] {
        assert_eq!(
            left_open_by_test_file(statements),
            (false, false),
            "{statements}"
        );
    }
}

#[test]
fn text_that_nobody_knows_may_lay_a_spy_where_a_file_of_the_tests_evaluates_it() {
    for statements in [
        "eval(made());",
        "(eval as any)(made());",
        "eval('new Function(' + made() + ')()');",
    ] {
        assert_eq!(
            left_open_by_test_file(statements),
            (true, false),
            "{statements}"
        );
    }
    // Global code sees no name of the file.
    for statements in [
        "new Function('ns', made())(lib);",
        "Function('ns', made())(lib);",
        "(0, eval)(made());",
        "globalThis.eval(made());",
        "toolsOf(eval);",
        "new Function('a', 'return a')(1);",
        "(0, eval)('1 + 1');",
        "console.log(lib.total instanceof Function, typeof eval, Function.prototype.call);",
        "expect(lib).toEqual({ total: expect.any(Function) });",
        "expect(lib.total).toBeInstanceOf(Function);",
        "expect(lib.total).not.toBe(eval);",
    ] {
        assert_eq!(
            left_open_by_test_file(statements),
            (false, false),
            "{statements}"
        );
    }
}

#[test]
fn what_a_file_of_the_product_lets_go_counts_for_nothing() {
    let files = [
        (
            "a.test.ts",
            "import { test } from 'bun:test';\nimport { capture } from './src/util';\ntest('a', () => { capture(1); });\n",
        ),
        (
            "src/util.ts",
            "declare const made: () => string;\nexport const capture = (globalThis as any)[made()];\nexport const run = Function('return ' + made());\n",
        ),
        ("src/main.ts", "import './util';\n"),
        MANIFEST,
    ];
    with_run(&files, (1, 0), |files, run| {
        assert_eq!(whose(files, run, "src/util.ts"), WhoseFile::OfProduct);
        let file = files.by_path.get(b"/project/src/util.ts").unwrap();
        let of_run = &parsed_source(files, file).unwrap().of_run;
        assert!(of_run.evaluates_unknown_text);
        assert!(!run.spies_under_any_name && !run.mocks_any_module);
    });
}

mod texts {
    use super::{MANIFEST, texts_of, with_run};

    const CONFIG: &str = "const config = `[core]\n\teditor = vi \\\n[user]\n\tworktree = ${process.env.NOBODY_KNOWS}\n`;";
    const CONSTANT: &str = "const config = `[core]\n\teditor = vi \\\n[user]\n`;";
    const UNPARSED: &str = "const config = `In ${process.env.NOBODY_KNOWS} write using spy = spyOn(...) and the spy is put back.`;";
    const WHERE: &str = "process.env.WHERE_NOTHING_IS";

    /// Whether a spy may be anywhere, and whether any module may be mocked: what a text that counts leaves open here.
    fn counts(imports: &str, runs: &str, text: &str) -> (bool, bool) {
        let runs = runs.replace("WHERE", WHERE);
        let test_file = format!(
            "import {{ test }} from \"bun:test\";\nimport * as lib from \"../src/lib\";\n{imports}\nconst held = {{ lib }};\n{text}\ntest(\"the text is written nowhere\", async () => {{\n  console.log(\"TEXT \" + held.lib.answer() + \" \" + held.lib.other() + \" \" + config.length);\n  if ({WHERE}) {{ {runs} }}\n}});\n"
        );
        let texts = format!("export {CONFIG}\n");
        let files = [
            ("test/a.test.ts", &test_file[..]),
            MANIFEST,
            (
                "src/lib.ts",
                "export function answer(): string { return \"real\"; }\nexport function other(): number { return 1; }\n",
            ),
            ("src/texts.ts", &texts[..]),
            (
                "src/plugins.ts",
                "export const loadPlugin = (path: string) => import(path);\n",
            ),
            (
                "test/loader.ts",
                "export const load = (path: string) => import(path);\n",
            ),
            // What makes the three files below src/ the product's: a file of the project that no test reaches imports them.
            (
                "src/main.ts",
                "import './lib';\nimport './texts';\nimport './plugins';\n",
            ),
        ];
        with_run(&files, (1, 0), |_, run| {
            (run.spies_under_any_name, run.mocks_any_module)
        })
    }

    /// A text that is no code can read like code: in this configuration of git, `editor = vi [user]` hands on a member of the test runner's `vi`. Code runs only where something
    /// runs it: a text counts where its test file reaches a load under a path that nobody reads, a Worker, or whatever evaluates text, and where the text itself goes somewhere.
    #[test]
    fn a_text_that_reads_like_code_counts_where_its_test_file_can_run_it() {
        // What the test file imports, what it runs, the text that it holds, what is left open.
        let closed = (false, false);
        let open = (true, true);
        let ways = [
            ("", "", CONFIG, closed),
            // It loads no code from disk, as in the executable.
            (
                "import { loadPlugin } from \"../src/plugins\";",
                "await loadPlugin(WHERE);",
                CONFIG,
                closed,
            ),
            // A text of the code under test is no code of the tests, whatever the test file beside it can run.
            (
                "import { config } from \"../src/texts\";",
                "await import(WHERE);",
                "",
                closed,
            ),
            // What a tree that the parser has mended leaves open is the mending's.
            ("", "await import(WHERE);", UNPARSED, closed),
            ("", "await import(WHERE);", CONFIG, open),
            ("", "require(WHERE);", CONFIG, open),
            (
                "import { load } from \"./loader\";",
                "await load(WHERE);",
                CONFIG,
                open,
            ),
            // Whatever gets the text itself may run it, whether the build knows it for something that does or not.
            (
                "",
                "await import(\"data:text/javascript,\" + encodeURIComponent(config));",
                CONFIG,
                open,
            ),
            (
                "",
                "await import(\"data:text/javascript,\" + encodeURIComponent(config));",
                CONSTANT,
                open,
            ),
            ("", "(globalThis as any).run(config);", CONFIG, open),
            ("", "new Worker(WHERE);", CONFIG, open),
            ("", "(0, eval)(WHERE);", CONFIG, open),
            ("", "new Function(WHERE)();", CONFIG, open),
        ];
        let wrong: Vec<&str> = (ways.into_iter())
            .filter(|&(imports, runs, text, expected)| counts(imports, runs, text) != expected)
            .map(|way| way.1)
            .collect();
        assert!(wrong.is_empty(), "{wrong:?}");
    }

    /// What `write(<text>)` in a test file says: `write` is a function that nobody knows, so the text counts whatever stands near the file.
    fn read(text: &str) -> (Vec<String>, Vec<String>, (bool, bool)) {
        let test_file = format!(
            "import {{ test }} from 'bun:test';\ndeclare const write: (text: string) => void;\ndeclare const value: string, method: string, name: string, keyword: string;\ntest('a', () => {{ write({text}); }});\n"
        );
        let files = [("a.test.ts", &test_file[..]), MANIFEST];
        with_run(&files, (1, 0), |files, run| {
            (
                texts_of(files, &run.names_spied),
                texts_of(files, &run.modules_replaced_in_text),
                (run.spies_under_any_name, run.mocks_any_module),
            )
        })
    }

    #[test]
    fn nobody_runs_a_message() {
        let is_left_open = |statements: &str| {
            let test_file = format!(
                "import {{ test }} from 'bun:test';\ndeclare const write: (text: string) => void;\ndeclare const name: string;\ntest('a', () => {{ {statements} }});\n"
            );
            let files = [("a.test.ts", &test_file[..]), MANIFEST];
            with_run(&files, (1, 0), |_, run| run.spies_under_any_name)
        };
        const HINT: &str = r#"`import { spyOn } from "bun:test"; spyOn(held, '${name}');`"#;
        for statements in [
            "throw new Error(HINT);",
            "throw new TypeError(HINT);",
            "throw RangeError(HINT);",
            "console.warn(HINT);",
            "const hint = HINT; console.error(hint); throw new Error(hint);",
        ] {
            assert!(
                !is_left_open(&statements.replace("HINT", HINT)),
                "{statements}"
            );
        }
        for statements in [
            "write(HINT);",
            "throw new (globalThis as any).Failure(HINT);",
            "const hint = HINT; console.warn(hint); write(hint);",
            "class Failure extends Error {} throw new Failure(HINT);",
        ] {
            assert!(
                is_left_open(&statements.replace("HINT", HINT)),
                "{statements}"
            );
        }
    }

    #[test]
    fn a_spy_in_a_template_that_parses_under_no_filler_is_found() {
        let head = r#"import { spyOn } from "bun:test"; import * as lib from "./lib"; spyOn(lib, "total");"#;
        for tail in [
            "lib.other();",
            "lib.other(${value});",
            "lib.${method}();",
            "function ${name}() {}",
            "${keyword} held = 1;",
        ] {
            let (names, _, left_open) = read(&format!("`{head} {tail}`"));
            assert_eq!(
                (names, left_open),
                (vec!["total".to_owned()], (false, false)),
                "{tail}"
            );
        }
        // Nothing runs a text that is no code, and it has no part that the run fills in.
        let (names, modules, left_open) = read(&format!("'{head} lib.();'"));
        assert!(names.is_empty() && modules.is_empty() && left_open == (false, false));
    }

    #[test]
    fn a_hole_stands_for_what_nobody_knows() {
        let imports = r#"import { mock, spyOn } from "bun:test"; import * as lib from "./lib";"#;
        let (_, _, left_open) = read(&format!("`{imports} spyOn({{}}, \"${{name}}\");`"));
        assert_eq!(left_open, (true, false));
        let (_, _, left_open) = read(&format!(
            "`{imports} mock.module(${{value}}, () => ({{}}));`"
        ));
        assert_eq!(left_open, (true, true));
        let (_, modules, left_open) = read(&format!("`{imports} spyOn(lib, ${{name}});`"));
        assert_eq!(
            (modules, left_open),
            (vec!["./lib".to_owned()], (false, false))
        );
        let (_, modules, left_open) = read(&format!(
            "`{imports} mock.module(\"../far.js\", () => ({{}}));`"
        ));
        assert_eq!(
            (modules, left_open),
            (vec!["../far.js".to_owned()], (false, false))
        );
        let (_, modules, left_open) = read(
            r#"`import * as far from "${value}"; import { spyOn } from "bun:test"; spyOn(far, ${name});`"#,
        );
        assert_eq!((modules, left_open), (Vec::new(), (true, true)));
    }

    #[test]
    fn a_text_that_spells_no_way_to_the_runner_is_not_read() {
        let (names, modules, left_open) =
            read("'export const lay = (take, object) => take(object, \"total\").restore();'");
        assert!(names.is_empty() && modules.is_empty() && left_open == (false, false));
    }
}

#[test]
fn the_end_of_a_path_names_the_module_of_a_text() {
    let rows = [
        ("/project/src/lib.ts", "../lib.js", true),
        ("/project/src/lib.ts", "./src/lib", true),
        ("/project/src/lib.ts", "/project/src/lib.ts", true),
        ("/project/src/lib/index.ts", "./lib", true),
        ("/project/src/mylib.ts", "./lib", false),
        ("/project/src/lib.ts", "./other/lib", false),
        ("/project/src/lib.ts", "./", false),
    ];
    for (path, written, expected) in rows {
        let ends = ends_with_module_in_text(path.as_bytes(), written.as_bytes());
        assert_eq!(ends, expected, "{path} {written}");
    }
}

#[test]
fn every_member_that_a_test_may_replace_is_written_as_a_read() {
    let files = [(
        "a.test.ts",
        "import { test } from 'bun:test';\ntest('a', () => {});\n",
    )];
    with_run(&files, (1, 0), |_, run| {
        let listed = &run.members_written_as_reads;
        assert!(listed.is_sorted_by(|left, right| left < right));
        let has = |member: BuiltinId| listed.binary_search(&member.to_wire()).is_ok();
        assert!(has(BuiltinId::MathFloor) && has(BuiltinId::ArrayIsArray));
        assert!(has(BuiltinId::Map) && has(BuiltinId::Math));
        // The table leaves `Date.now` writable in every build: it is a read already.
        assert!(!has(BuiltinId::DateNow));
        // Nothing replaces `prototype` on the Map of the table. A test that replaces `Map` replaces what `Map.prototype` reads.
        assert!(has(BuiltinId::MapPrototype) && has(BuiltinId::ObjectPrototype));
        assert!(has(BuiltinId::SymbolIterator) && has(BuiltinId::MathPI));
    });
}

#[test]
fn a_helper_that_spies_under_a_name_from_outside_opens_what_its_callers_pass_it() {
    let test_file = |name: &str, spied: &str| {
        format!(
            "import {{ test }} from \"bun:test\";\nimport {{ track }} from \"./helpers/track.js\";\nimport * as sums from \"./src/sums.js\";\ntest(\"{name}\", () => {{ track(sums, \"{spied}\").mockRestore(); }});\n"
        )
    };
    let (first, second) = (test_file("a", "total"), test_file("b", "twice"));
    let track = "import { spyOn } from \"bun:test\";\nexport function track(object, name) { return spyOn(object, name); }\n";
    let sums = "export function total() { return 1; }\nexport function twice() { return 2; }\nexport function thrice() { return 3; }\n";
    let files = [
        ("a.test.js", &first[..]),
        ("b.test.js", &second[..]),
        ("helpers/track.js", track),
        ("src/sums.js", sums),
        MANIFEST,
    ];
    with_run(&files, (2, 0), |files, run| {
        assert!(!run.spies_under_any_name && !run.mocks_any_module);
        assert_eq!(texts_of(files, &run.names_spied), ["total", "twice"]);
    });
    // Whoever calls what a file exports again calls the helper.
    let through = first.replace("./helpers/track.js", "./helpers/index.js");
    let files = [
        ("a.test.js", &through[..]),
        ("helpers/index.js", "export * from \"./inner.js\";\n"),
        (
            "helpers/inner.js",
            "export { track } from \"./track.js\";\n",
        ),
        ("helpers/track.js", track),
        ("src/sums.js", sums),
        MANIFEST,
    ];
    with_run(&files, (1, 0), |files, run| {
        assert!(!run.spies_under_any_name);
        assert_eq!(texts_of(files, &run.names_spied), ["total"]);
    });
    // A name that nobody spells may be any name.
    let unspelled = first.replace("\"total\"", "process.argv[2]");
    let files = [
        ("a.test.js", &unspelled[..]),
        ("helpers/track.js", track),
        ("src/sums.js", sums),
        MANIFEST,
    ];
    with_run(&files, (1, 0), |_, run| assert!(run.spies_under_any_name));
}

#[test]
fn a_helper_spells_the_names_of_its_own_spies_through_parameters_and_lists() {
    let net = "import { spyOn } from \"bun:test\";\nimport { holders } from \"../src/holders\";\nconst LISTED = [\"half\"] as const;\nfunction tapped(object: object, key: string) { return spyOn(object as Record<string, () => number>, key); }\nexport function net() { return [...LISTED.map(name => tapped(holders.math, name)), tapped(holders.math, \"add\")]; }\n";
    let files = [
        (
            "one.test.ts",
            "import { test } from \"bun:test\";\nimport { net } from \"./helpers/net\";\ntest(\"a\", () => { net(); });\n",
        ),
        ("helpers/net.ts", net),
        (
            "src/holders.ts",
            "import * as math from \"./math\";\nexport const holders: Record<string, any> = { math };\n",
        ),
        (
            "src/math.ts",
            "export function add() { return 1; }\nexport function half() { return 2; }\n",
        ),
        MANIFEST,
    ];
    with_run(&files, (1, 0), |files, run| {
        assert!(!run.spies_under_any_name);
        assert_eq!(texts_of(files, &run.names_spied), ["add", "half"]);
    });
}

#[test]
fn a_callback_takes_its_names_from_what_the_call_in_front_was_handed() {
    let names_of = |statements: &str| {
        let test_file = format!(
            "import {{ spyOn, test }} from \"bun:test\";\nimport {{ holders }} from \"./src/holders\";\nconst ROWS = [[\"half\", 1], [\"add\", 2]] as const;\n{statements}\n"
        );
        let files = [
            ("one.test.ts", &test_file[..]),
            (
                "src/holders.ts",
                "import * as math from \"./math\";\nexport const holders: Record<string, any> = { math };\n",
            ),
            (
                "src/math.ts",
                "export function add() { return 1; }\nexport function half() { return 2; }\n",
            ),
            MANIFEST,
        ];
        with_run(&files, (1, 0), |files, run| {
            (run.spies_under_any_name, texts_of(files, &run.names_spied))
        })
    };
    let both = (false, vec!["add".to_string(), "half".to_string()]);
    for statements in [
        "test.each([[\"half\", 1], [\"add\", 2]])(\"%s\", (name, count) => { spyOn(holders.math, name); });",
        "test.each([[1, \"half\"], [2, \"add\"]])(\"%s\", (count, name) => { spyOn(holders.math, name); });",
        "test.each([\"half\", \"add\"])(\"%s\", name => { spyOn(holders.math, name); });",
        "test.each(ROWS)(\"%s\", (name, count) => { spyOn(holders.math, name); });",
        "test.each([{ name: \"half\" }, { name: \"add\" }])(\"$name\", ({ name }) => { spyOn(holders.math, name); });",
        "for (const [name, count] of ROWS) spyOn(holders.math, name);",
        "for (const { name } of [{ name: \"half\" }, { name: \"add\" }]) spyOn(holders.math, name);",
        "const lay = (name: string) => spyOn(holders.math, name); for (const [name, count] of ROWS) lay(name);",
    ] {
        assert_eq!(names_of(statements), both, "{statements}");
    }
    let filled = (false, vec!["had".to_string(), "half".to_string()]);
    for statements in [
        "for (const end of [\"lf\", \"d\"]) spyOn(holders.math, `ha${end}`);",
        "for (const end of [\"lf\", \"d\"]) spyOn(holders.math, \"ha\" + end);",
    ] {
        assert_eq!(names_of(statements), filled, "{statements}");
    }
    // A name that nobody spells may be any name.
    for statements in [
        "test.each(process.argv)(\"%s\", name => { spyOn(holders.math, name); });",
        "for (const [name] of process.argv.map(it => [it])) spyOn(holders.math, name);",
        "for (const end of process.argv) spyOn(holders.math, `ha${end}`);",
        "test.each([[\"half\"]].map(row => [row[0] + \"\"]))(\"%s\", name => { spyOn(holders.math, name); });",
    ] {
        assert!(names_of(statements).0, "{statements}");
    }
}

#[test]
fn a_name_that_is_made_out_of_itself_may_be_any_name() {
    let names_of = |statements: &str| {
        let test_file = format!(
            "import {{ spyOn, test }} from \"bun:test\";\nimport {{ holders }} from \"./src/holders\";\n{statements}\n"
        );
        let files = [
            ("one.test.ts", &test_file[..]),
            (
                "src/holders.ts",
                "import * as math from \"./math\";\nexport const holders: Record<string, any> = { math };\n",
            ),
            (
                "src/math.ts",
                "export function add() { return 1; }\nexport function half() { return 2; }\n",
            ),
            MANIFEST,
        ];
        with_run(&files, (1, 0), |files, run| {
            (run.spies_under_any_name, texts_of(files, &run.names_spied))
        })
    };
    for statements in [
        "function watch(name: string, left: number) { spyOn(holders.math, name); if (left > 0) watch(name + \"f\", left - 1); }\nwatch(\"hal\", 1);",
        "function watch(name: string, left: number) { spyOn(holders.math, name); if (left > 0) watch(`${name}f`, left - 1); }\nwatch(\"hal\", 1);",
        "function watch(name: string, left: number) { spyOn(holders.math, \"h\" + name); if (left > 0) watch(name + \"f\", left - 1); }\nwatch(\"al\", 1);",
        "function one(name: string, left: number) { spyOn(holders.math, name); if (left > 0) two(name + \"l\", left - 1); }\nfunction two(name: string, left: number) { spyOn(holders.math, name); if (left > 0) one(name + \"f\", left - 1); }\none(\"ha\", 2);",
        "function one(name: string, left: number) { spyOn(holders.math, name); if (left > 0) two(name + \"a\", left - 1); }\nfunction two(name: string, left: number) { three(`${name}l`, left); }\nfunction three(name: string, left: number) { one(name + \"f\", left); }\none(\"h\", 1);",
        "function watch(left: number, name = \"hal\") { spyOn(holders.math, name); if (left > 0) watch(left - 1, name + \"f\"); }\nwatch(1);",
        "var ROWS = [\"half\", other + \"f\"];\nvar [other] = ROWS;\nfor (const name of ROWS) spyOn(holders.math, name);",
    ] {
        assert!(names_of(statements).0, "{statements}");
    }
    // A name that goes round as it is, and a text with holes that is reached twice and not from inside itself.
    for (statements, names) in [
        (
            "function watch(name: string, left: number) { if (left === 0) spyOn(holders.math, name); else watch(name, left - 1); }\nwatch(\"half\", 2);",
            ["half"],
        ),
        (
            "function lay(name: string) { spyOn(holders.math, name + name); }\nfunction both(end: string) { lay(\"a\" + end); }\nboth(\"d\");",
            ["adad"],
        ),
    ] {
        assert_eq!(
            names_of(statements),
            (false, names.map(str::to_string).to_vec()),
            "{statements}"
        );
    }
}

#[test]
fn a_name_stored_on_an_object_from_somewhere_may_come_to_lie_on_a_closed_object_that_was_let_go() {
    let added = |statements: &str| {
        let test_file = format!(
            "import {{ test }} from 'bun:test';\nconst put = (object: any) => {{ object.__mark = 1; }};\ntest('a', () => {{ {statements} }});\n"
        );
        with_run(&[("a.test.ts", &test_file[..])], (1, 0), |files, run| {
            let added = run.names_added.iter();
            let added = added.filter(|it| it.0 == BuiltinId::ObjectPrototype);
            texts_of(files, &added.map(|it| it.1).collect::<Vec<_>>())
        })
    };
    assert_eq!(added("put(Object.prototype);"), ["__mark"]);
    assert!(added("put({}); console.log(Object.prototype.hasOwnProperty);").is_empty());
}

#[test]
fn a_stored_name_goes_with_the_file_that_lets_the_object_go_and_with_what_that_file_imports() {
    let added = |lets_go: &str, other: &str| {
        let files = [
            ("a.test.ts", lets_go),
            ("b.test.ts", other),
            (
                "put.ts",
                "export const put = (object: any) => { object.__imported = 1; };\n",
            ),
        ];
        with_run(&files, (2, 0), |files, run| {
            let added = run.names_added.iter();
            let added = added.filter(|it| it.0 == BuiltinId::ObjectPrototype);
            texts_of(files, &added.map(|it| it.1).collect::<Vec<_>>())
        })
    };
    let far = "import { test } from 'bun:test';\n(globalThis as any).far = (object: any) => { object.__far = 1; };\ntest('b', () => {});\n";
    let imports = "import { test } from 'bun:test';\nimport { put } from './put';\ntest('a', () => { put(Object.prototype); });\n";
    assert_eq!(added(imports, far), ["__imported"]);
    let alone = "import { test } from 'bun:test';\ntest('a', () => { (globalThis as any).far(Object.prototype); });\n";
    assert!(added(alone, far).is_empty());
}

#[test]
fn bind_opens_the_names_that_go_to_a_helper_and_no_other() {
    let files = [
        (
            "a.test.js",
            "import { test } from \"bun:test\";\nimport { track } from \"./helpers/track.js\";\nimport * as sums from \"./src/sums.js\";\ntest(\"a\", () => { track(sums, \"total\").mockRestore(); });\n",
        ),
        (
            "helpers/track.js",
            "import { spyOn } from \"bun:test\";\nexport function track(object, name) { return spyOn(object, name); }\n",
        ),
        (
            "src/sums.js",
            "export function total() { return 1; }\nexport function thrice() { return 3; }\n",
        ),
        MANIFEST,
    ];
    with_bound_run(&files, (1, 0), |files, graph| {
        assert!(is_replaceable(files, graph, "src/sums.js", "total"));
        assert!(!is_replaceable(files, graph, "src/sums.js", "thrice"));
    });
}

#[test]
fn bind_opens_what_is_handed_out_where_text_that_nobody_knows_is_evaluated() {
    let files = [
        (
            "a.test.ts",
            "import { spyOn, test } from 'bun:test';\nimport * as lib from './src/lib';\nimport { kept } from './src/kept';\ndeclare const made: () => string;\ntest('a', () => { STATEMENT; kept(); });\n",
        ),
        ("src/lib.ts", "export function total() { return 1; }\n"),
        ("src/kept.ts", "export function kept() { return 1; }\n"),
        ("src/main.ts", "import './lib';\nimport './kept';\n"),
        MANIFEST,
    ];
    // A direct `eval` . global code that is handed an object of the runner . global code that is handed none.
    for (statement, is_open) in [
        ("eval(made())(lib)", true),
        ("new Function('spy', 'ns', made())(spyOn, lib)", true),
        ("new Function('ns', made())(lib)", false),
    ] {
        let test_file = files[0].1.replace("STATEMENT", statement);
        let mut files = files;
        files[0].1 = &test_file;
        with_bound_run(&files, (1, 0), |files, graph| {
            assert_eq!(
                is_replaceable(files, graph, "src/lib.ts", "total"),
                is_open,
                "{statement}"
            );
            // No file hands its object on.
            assert!(
                !is_replaceable(files, graph, "src/kept.ts", "kept"),
                "{statement}"
            );
        });
    }
}

#[test]
fn bind_takes_the_file_that_a_text_mocks_for_mocked() {
    let files = [
        (
            "a.test.ts",
            "import { test } from 'bun:test';\nimport { far } from './src/far';\nimport { near } from './src/near';\ndeclare const write: (text: string) => void;\ntest('a', () => { write('import { mock } from \"bun:test\"; mock.module(\"../src/far.ts\", () => ({}));'); far(); near(); });\n",
        ),
        ("src/far.ts", "export const far = () => 1;\n"),
        ("src/near.ts", "export const near = () => 1;\n"),
        MANIFEST,
    ];
    with_bound_run(&files, (1, 0), |files, graph| {
        let module = |name: &str| ModuleRef::File(file_at(files, name));
        assert!(graph.may_be_mocked(module("src/far.ts")));
        assert!(graph.is_named_by_mock(module("src/far.ts")));
        assert!(!graph.may_be_mocked(module("src/near.ts")));
    });
}

#[test]
fn what_a_file_of_the_product_writes_on_a_built_in_opens_nothing_and_a_text_goes_by_its_file() {
    let files = [
        (
            "a.test.ts",
            "import { test } from 'bun:test';\nimport { patch } from 'patches';\nimport { write } from './src/write';\nconst run = (text: string) => new Function(text)();\ntest('a', () => { Math.max = () => 7; run('Buffer.isEncoding = () => true'); patch(); write(); });\n",
        ),
        (
            "src/write.ts",
            "Math.min = () => 7;\nexport const write = new Function('Buffer.byteLength = () => 7');\n",
        ),
        ("src/main.ts", "import './write';\n"),
        (
            "node_modules/patches/package.json",
            r#"{ "name": "patches", "version": "1.0.0", "main": "index.js" }"#,
        ),
        (
            "node_modules/patches/index.js",
            "exports.patch = new Function('fake', 'const kept = Math.random; Math.random = fake; return kept;');\nexports.note = 'Math.imul = 1';\n",
        ),
        MANIFEST,
    ];
    let project = project_of_run(&files, (1, 0));
    run_build(&project, BUNDLED_LIBS, &WithoutServices, |build| {
        build.with_loaded_projects(|_, loaded| {
            let replaced = &loaded.contents.replaced_builtins;
            let has = |member: BuiltinId| replaced.binary_search(&member.to_wire()).is_ok();
            assert!(has(BuiltinId::MathMax) && has(BuiltinId::BufferIsEncoding));
            assert!(has(BuiltinId::MathRandom));
            assert!(!has(BuiltinId::MathMin) && !has(BuiltinId::BufferByteLength));
            // A package evaluates what it hands to `Function`, and no other string of it is read.
            assert!(!has(BuiltinId::MathImul));
            Ok(())
        })
    });
}

#[test]
fn link_is_told_whose_a_file_is() {
    let mut files = PROJECT.to_vec();
    files.push(("src/main.ts", "import { app } from './app';\napp();\n"));
    with_bound_run(&files, (2, 1), |files, graph| {
        let flags = |name: &str| flags_of_module(graph, ModuleRef::File(file_at(files, name)));
        let of_product = flags("src/app.ts");
        assert!(of_product.contains(ModuleFlags::FINDS_BUILTINS_READ_ONLY));
        assert!(of_product.contains(ModuleFlags::LOADS_COMPILED_FILES_ALONE));
        let of_tests = flags("checks/latest.ts");
        assert!(!of_tests.contains(ModuleFlags::FINDS_BUILTINS_READ_ONLY));
        assert!(!of_tests.contains(ModuleFlags::LOADS_COMPILED_FILES_ALONE));
        let of_neither = flags("node_modules/tool/index.js");
        assert!(!of_neither.contains(ModuleFlags::FINDS_BUILTINS_READ_ONLY));
        assert!(of_neither.contains(ModuleFlags::LOADS_COMPILED_FILES_ALONE));
    });
}
