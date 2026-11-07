use super::test_run_ways::{AskedBy, Step, find_way_of_read, find_way_to_declaration, has_station};
use crate::compile::link_program;
use crate::compile::testing::{BUNDLED_LIBS, TestProject, default_settings, describe_messages};
use crate::ir::{Program, print_program};
use crate::load::source_provider::WithoutServices;
use crate::modules::testing::{file_named, symbol_named, with_test_run_graph};
use crate::modules::{BindInput, ModuleRef};
use bun_ast::Log;
use bun_sema::program::FileId;

const TEST_FILE: &str = "main.test.js";
const LIB: (&str, &str) = ("lib.js", "export const fn = () => 'real';\n");

fn write_test_file(mocked: &[&str], rest: &str) -> String {
    let mut text = String::from("import { mock } from 'bun:test';\n");
    for path in mocked {
        text.push_str(&format!("mock.module('./{path}', () => ({{}}));\n"));
    }
    text.push_str(rest);
    text
}

fn name_of(input: &BindInput<'_, '_>, file: FileId) -> String {
    let path = input.files.module(file).file_name();
    let name = path.strip_prefix(b"/project/").unwrap_or(path);
    String::from_utf8_lossy(name).into_owned()
}

fn describe(input: &BindInput<'_, '_>, steps: &[Step]) -> Vec<String> {
    let describe_step = |step: &Step| match *step {
        Step::Station {
            file,
            name,
            asked_by,
            asked_from,
            behind,
        } => {
            let file = name_of(input, file);
            let name = String::from_utf8_lossy(input.files.atoms.bytes(name)).into_owned();
            let asked_by = match asked_by {
                AskedBy::Statement => "the statement",
                AskedBy::Name => "its name",
                AskedBy::Star => "a star",
            };
            let asked_from = match asked_from {
                Some(file) => name_of(input, file),
                None => String::from("the reader"),
            };
            format!("{file} {name} by {asked_by} from {asked_from} behind {behind}")
        }
        Step::ModuleWithoutTable {
            module,
            name,
            is_behind_its_mock,
            ..
        } => {
            let file = match module {
                ModuleRef::File(file) => name_of(input, file),
                other => format!("{other:?}"),
            };
            let name = String::from_utf8_lossy(input.files.atoms.bytes(name)).into_owned();
            match is_behind_its_mock {
                true => format!("{file} itself may have {name}"),
                false => format!("{file} may have {name}"),
            }
        }
        Step::Declaration => String::from("declaration"),
    };
    steps.iter().map(describe_step).collect()
}

fn find_way(mocked: &[&str], others: &[(&str, &str)], asked: (&str, &str)) -> Vec<String> {
    let imports = format!("import * as all from './{}';\nconsole.log(all);\n", asked.0);
    let test_file = write_test_file(mocked, &imports);
    let mut files = vec![(TEST_FILE, test_file.as_str())];
    files.extend_from_slice(others);
    with_test_run_graph(&files, |graph, input| {
        let reader = file_named(input, TEST_FILE);
        let name = input.files.atoms.intern(asked.1.as_bytes());
        let asked = (file_named(input, asked.0), name);
        describe(input, &find_way_to_declaration(graph, Some(reader), asked))
    })
}

fn link_test_run(files: &[(&str, &str)]) -> Program {
    let mut project = TestProject::new(files, &default_settings());
    project.runs_tests = true;
    project.aot.runs_in_place = true;
    let mut log = Log::init();
    match link_program(&project.options(BUNDLED_LIBS), &WithoutServices, &mut log) {
        Ok(linked) => linked.program,
        Err(failed) => panic!(
            "the build failed in stage \"{}\":\n{}",
            failed.stage.name(),
            describe_messages(&log)
        ),
    }
}

fn find_stations(mocked: &[&str], rest: &str, others: &[(&str, &str)]) -> Vec<String> {
    let test_file = write_test_file(mocked, rest);
    let mut files = vec![(TEST_FILE, test_file.as_str())];
    files.extend_from_slice(others);
    let program = link_test_run(&files);
    let file_of = |line: &str, field: &str| -> Option<String> {
        let mut words = line.split_whitespace();
        let module: usize = words
            .find_map(|word| word.strip_prefix(field))?
            .parse()
            .ok()?;
        let path = program.strings.get(program.modules[module].path);
        let name = path.rsplit(|&byte| byte == b'/').next().unwrap_or(path);
        Some(String::from_utf8_lossy(name).into_owned())
    };
    let mut is_in_test_file = false;
    let mut stations = Vec::new();
    for line in print_program(&program).lines() {
        if line.starts_with("function ") {
            is_in_test_file = file_of(line, "module=m").as_deref() == Some(TEST_FILE);
        }
        if is_in_test_file && line.contains(" = SeesMockOf ") {
            let mocked = file_of(line, "module=m").expect("the operation names a module");
            let importer = file_of(line, "referrer=m").expect("the operation names a referrer");
            stations.push(format!("{mocked} seen by {importer}"));
        }
    }
    stations
}

fn find_asks_of_user(test_file: &str, uses: &str) -> Vec<&'static str> {
    let program = link_test_run(&[(TEST_FILE, test_file), ("uses.js", uses)]);
    let mut is_in_user = false;
    let mut asks = Vec::new();
    for line in print_program(&program).lines() {
        if line.starts_with("function ") {
            let module = line
                .split_whitespace()
                .find_map(|word| word.strip_prefix("module=m"));
            let module: usize = module
                .and_then(|it| it.parse().ok())
                .expect("a function has a module");
            is_in_user = program
                .strings
                .get(program.modules[module].path)
                .ends_with(b"/uses.js");
        }
        for operation in ["ModuleNamespace", "RequireModule"] {
            if is_in_user && line.contains(&format!(" = {operation} ")) {
                asks.push(operation);
            }
        }
    }
    asks
}

#[test]
fn module_that_mocks_alone_make_is_asked_for_at_each_read() {
    let uses = "import { who } from 'vscode';\nimport * as all from 'vscode';\nexport const use = () => [who(), all.who()];\n";
    let mocks = "import { mock } from 'bun:test';\nmock.module('vscode', () => ({ who: () => 1 }));\nconst { use } = await import('./uses.js');\nuse();\n";
    assert_eq!(
        find_asks_of_user(mocks, uses),
        ["RequireModule", "RequireModule"]
    );
    let mocks_another = mocks.replace("mock.module('vscode'", "mock.module('electron'");
    assert_eq!(
        find_asks_of_user(&mocks_another, uses),
        ["ModuleNamespace", "ModuleNamespace"]
    );
}

#[test]
fn computed_load_may_name_a_declaration_file_beside_a_spy() {
    let loads = "const folder = new URL('./lib/', import.meta.url); // @ts-expect-error\nconst loaded = await import(new URL(String(globalThis.name), folder).href);\nconsole.log(loaded);\n";
    let spies = "import { spyOn } from 'bun:test';\nimport type { more } from './lib/more';\nexport type More = typeof more; // @ts-expect-error\nspyOn(globalThis.somebody, 'run');\n";
    let mocks = "import { mock } from 'bun:test';\nimport type { more } from './lib/more';\nexport type More = typeof more;\nmock.module('./lib/more', () => ({ more: 1 }));\n";
    for head in [spies, mocks] {
        let test_file = format!("{head}{loads}");
        let files = [
            ("main.test.ts", &test_file[..]),
            ("lib/more.d.ts", "export declare const more: number;\n"),
            (
                "lib/real.ts",
                "export * from './below';\nexport const real = 1;\n",
            ),
            ("lib/below.ts", "export const below = 1;\n"),
        ];
        let program = link_test_run(&files);
        let paths = program
            .modules
            .iter()
            .map(|module| program.strings.get(module.path));
        for name in [&b"/lib/real.ts"[..], b"/lib/more.d.ts"] {
            assert!(paths.clone().any(|path| path.ends_with(name)));
        }
    }
}

const READS_FN: &str = "import { fn } from './barrel.js';\nconsole.log(fn);\n";

#[test]
fn file_that_the_statement_names_is_a_station() {
    let way = find_way(&["lib.js"], &[LIB], ("lib.js", "fn"));
    assert_eq!(
        way,
        [
            "lib.js fn by the statement from the reader behind 2",
            "declaration"
        ]
    );
    let reads = "import { fn } from './lib.js';\nconsole.log(fn);\n";
    assert_eq!(
        find_stations(&["lib.js"], reads, &[LIB]),
        ["lib.js seen by main.test.js"]
    );
}

#[test]
fn name_that_is_handed_on_is_asked_of_each_file_under_the_name_it_has_there() {
    let files = [
        ("barrel.js", "export { a as b } from './lib.js';\n"),
        ("lib.js", "export const a = () => 'real';\n"),
    ];
    assert_eq!(
        find_way(&["barrel.js", "lib.js"], &files, ("barrel.js", "b")),
        [
            "barrel.js b by the statement from the reader behind 3",
            "lib.js a by its name from barrel.js behind 3",
            "declaration"
        ]
    );
    assert_eq!(
        find_way(&["lib.js"], &files, ("barrel.js", "b")),
        [
            "lib.js a by its name from barrel.js behind 2",
            "declaration"
        ]
    );
    let reads = "import { b } from './barrel.js';\nconsole.log(b);\n";
    assert_eq!(
        find_stations(&["barrel.js", "lib.js"], reads, &files),
        ["barrel.js seen by main.test.js", "lib.js seen by barrel.js"]
    );
}

#[test]
fn name_that_comes_back_to_a_file_under_another_name_goes_on_to_the_mock() {
    let files = [
        (
            "index.js",
            "export * from './legacy.js';\nexport { make } from './api.js';\n",
        ),
        (
            "legacy.js",
            "export { make as create } from './index.js';\n",
        ),
        ("api.js", "export { make } from './impl.js';\n"),
        ("impl.js", "export const make = () => 'real';\n"),
    ];
    assert_eq!(
        find_way(&["api.js"], &files, ("index.js", "create")),
        [
            "api.js make by its name from index.js behind 2",
            "declaration"
        ]
    );
}

#[test]
fn name_that_is_handed_on_twice_has_a_station_for_the_third_file() {
    let files = [
        ("outer.js", "export { b as c } from './inner.js';\n"),
        ("inner.js", "export { a as b } from './lib.js';\n"),
        ("lib.js", "export const a = () => 'real';\n"),
    ];
    assert_eq!(
        find_way(
            &["outer.js", "inner.js", "lib.js"],
            &files,
            ("outer.js", "c")
        ),
        [
            "outer.js c by the statement from the reader behind 4",
            "inner.js b by its name from outer.js behind 4",
            "lib.js a by its name from inner.js behind 4",
            "declaration"
        ]
    );
    let reads = "import { c } from './outer.js';\nconsole.log(c);\n";
    assert_eq!(
        find_stations(&["inner.js"], reads, &files),
        ["inner.js seen by outer.js"]
    );
}

#[test]
fn import_that_a_file_exports_hands_the_name_on() {
    let files = [
        (
            "barrel.js",
            "import { a } from './lib.js';\nexport { a as b };\n",
        ),
        ("lib.js", "export const a = 1;\n"),
    ];
    assert_eq!(
        find_way(&["lib.js"], &files, ("barrel.js", "b")),
        [
            "lib.js a by its name from barrel.js behind 2",
            "declaration"
        ]
    );
}

#[test]
fn default_export_is_handed_on_by_its_name_and_by_no_star() {
    let lib = ("lib.js", "export default 1;\nexport const fn = 2;\n");
    let by_name = [("barrel.js", "export { default } from './lib.js';\n"), lib];
    assert_eq!(
        find_way(&["lib.js"], &by_name, ("barrel.js", "default")),
        [
            "lib.js default by its name from barrel.js behind 2",
            "declaration"
        ]
    );
    let by_star = [("barrel.js", "export * from './lib.js';\n"), lib];
    let way = find_way(&["lib.js"], &by_star, ("barrel.js", "default"));
    assert_eq!(way, [""; 0]);
}

#[test]
fn file_that_a_star_names_is_a_station() {
    let files = [("barrel.js", "export * from './lib.js';\n"), LIB];
    assert_eq!(
        find_way(&["lib.js"], &files, ("barrel.js", "fn")),
        ["lib.js fn by a star from barrel.js behind 2", "declaration"]
    );
    assert_eq!(
        find_stations(&["lib.js"], READS_FN, &files),
        ["lib.js seen by barrel.js"]
    );
}

#[test]
fn mock_behind_a_star_that_lacks_the_name_sends_the_question_to_the_next_star() {
    let files = [
        (
            "barrel.js",
            "export * from './first.js';\nexport * from './second.js';\n",
        ),
        ("first.js", "export const other = 1;\n"),
        ("second.js", "export const fn = () => 'real';\n"),
    ];
    assert_eq!(
        find_way(&["first.js", "second.js"], &files, ("barrel.js", "fn")),
        [
            "first.js fn by a star from barrel.js behind 1",
            "second.js fn by a star from barrel.js behind 3",
            "declaration"
        ]
    );
    assert_eq!(
        find_stations(&["first.js", "second.js"], READS_FN, &files),
        ["first.js seen by barrel.js", "second.js seen by barrel.js"]
    );
}

#[test]
fn file_behind_two_mocked_files_is_asked_below_each() {
    let files = [
        (
            "barrel.js",
            "export * from './s1.js';\nexport * from './s2.js';\n",
        ),
        ("s1.js", "export * from './lib.js';\n"),
        ("s2.js", "export * from './lib.js';\n"),
        LIB,
    ];
    assert_eq!(
        find_way(&["s1.js", "s2.js"], &files, ("barrel.js", "fn")),
        [
            "s1.js fn by a star from barrel.js behind 2",
            "declaration",
            "s2.js fn by a star from barrel.js behind 4",
            "declaration"
        ]
    );
}

#[test]
fn file_between_two_barrels_is_a_station() {
    let files = [
        ("barrel.js", "export * from './middle.js';\n"),
        ("middle.js", "export * from './inner.js';\n"),
        ("inner.js", "export { fn } from './lib.js';\n"),
        LIB,
    ];
    assert_eq!(
        find_way(&["middle.js"], &files, ("barrel.js", "fn")),
        [
            "middle.js fn by a star from barrel.js behind 2",
            "declaration"
        ]
    );
    assert_eq!(
        find_stations(&["middle.js"], READS_FN, &files),
        ["middle.js seen by barrel.js"]
    );
}

#[test]
fn star_over_a_file_that_hands_the_name_on_leads_to_the_mock() {
    let files = [
        ("barrel.js", "export * from './inner.js';\n"),
        ("inner.js", "export { fn } from './lib.js';\n"),
        LIB,
    ];
    assert_eq!(
        find_way(&["lib.js"], &files, ("barrel.js", "fn")),
        [
            "lib.js fn by its name from inner.js behind 2",
            "declaration"
        ]
    );
    assert_eq!(
        find_stations(&["lib.js"], READS_FN, &files),
        ["lib.js seen by inner.js"]
    );
}

#[test]
fn file_between_behind_an_ordinary_star_is_a_station() {
    let files = [
        ("barrel.js", "export * from './inner.js';\n"),
        ("inner.js", "export { fn } from './middle.js';\n"),
        ("middle.js", "export { fn } from './lib.js';\n"),
        LIB,
    ];
    assert_eq!(
        find_way(&["middle.js"], &files, ("barrel.js", "fn")),
        [
            "middle.js fn by its name from inner.js behind 2",
            "declaration"
        ]
    );
    assert_eq!(
        find_stations(&["middle.js"], READS_FN, &files),
        ["middle.js seen by inner.js"]
    );
}

#[test]
fn ordinary_star_beside_a_star_whose_names_show_in_the_run_is_asked_too() {
    let files = [
        (
            "barrel.js",
            "export * from './dep.cjs';\nexport * from './inner.js';\n",
        ),
        ("dep.cjs", "exports.other = 1;\n"),
        ("inner.js", "export { fn } from './middle.js';\n"),
        ("middle.js", "export { fn } from './lib.js';\n"),
        LIB,
    ];
    assert_eq!(
        find_way(&["middle.js"], &files, ("barrel.js", "fn")),
        [
            "dep.cjs may have fn",
            "middle.js fn by its name from inner.js behind 3",
            "declaration"
        ]
    );
    assert_eq!(
        find_stations(&["middle.js"], READS_FN, &files),
        ["middle.js seen by inner.js"]
    );
}

#[test]
fn commonjs_file_behind_a_mock_that_lacks_the_name_is_asked_in_the_run() {
    let files = [
        (
            "barrel.js",
            "export * from './lib.js';
export * from './more.cjs';
",
        ),
        LIB,
        (
            "more.cjs",
            "exports.fn = () => 'more';
",
        ),
    ];
    assert_eq!(
        find_way(&["lib.js"], &files, ("barrel.js", "fn")),
        [
            "lib.js fn by a star from barrel.js behind 2",
            "declaration",
            "more.cjs may have fn"
        ]
    );
}

#[test]
fn built_in_module_in_front_of_a_mocked_file_is_asked_in_the_run() {
    let files = [
        (
            "barrel.js",
            "export * from 'node:path';\nexport * from './lib.js';\n",
        ),
        LIB,
    ];
    assert_eq!(
        find_way(&["lib.js"], &files, ("barrel.js", "fn")),
        [
            "Runtime(NodePath) may have fn",
            "lib.js fn by a star from barrel.js behind 3",
            "declaration"
        ]
    );
}

#[test]
fn built_in_module_that_a_mock_names_is_asked_in_the_name_of_the_file_that_holds_the_statement() {
    let others = [("between.js", "export { sep } from 'node:path';\n")];
    let rest = "mock.module('node:path', () => ({}));
import { sep } from './between.js';
import { join } from 'node:path';
console.log(sep, join);
";
    assert_eq!(
        find_stations(&[], rest, &others),
        [
            "node:path seen by between.js",
            "node:path seen by main.test.js"
        ]
    );
}

#[test]
fn commonjs_file_that_two_files_hold_a_star_to_is_asked_itself_on_each_road() {
    let files = [
        (
            "barrel.js",
            "export * from './early.js';
export * from './part.cjs';
",
        ),
        (
            "early.js",
            "export * from './part.cjs';
",
        ),
        (
            "part.cjs",
            "exports.kept = 1;
",
        ),
    ];
    assert_eq!(
        find_way(&["part.cjs"], &files, ("barrel.js", "added")),
        [
            "part.cjs added by a star from early.js behind 2",
            "part.cjs itself may have added",
            "part.cjs added by a star from barrel.js behind 4",
            "part.cjs itself may have added"
        ]
    );
}

#[test]
fn ring_of_stars_ends() {
    let files = [
        ("a.js", "export * from './b.js';\nexport const own = 1;\n"),
        (
            "b.js",
            "export * from './a.js';\nexport * from './lib.js';\n",
        ),
        LIB,
    ];
    assert_eq!(
        find_way(&["lib.js"], &files, ("a.js", "fn")),
        ["lib.js fn by a star from b.js behind 2", "declaration"]
    );
    assert_eq!(
        find_way(&["lib.js"], &files, ("a.js", "own")),
        ["declaration"]
    );
}

#[test]
fn namespace_that_is_handed_on_has_no_station_for_the_names_below_it() {
    let files = [("barrel.js", "export * as ns from './lib.js';\n"), LIB];
    assert_eq!(
        find_way(&["lib.js"], &files, ("barrel.js", "ns")),
        ["declaration"]
    );
    let reads = "import { ns } from './barrel.js';\nconsole.log(ns);\n";
    assert_eq!(find_stations(&["lib.js"], reads, &files), [""; 0]);
}

#[test]
fn file_that_reads_its_own_name_through_a_barrel_is_no_station_for_itself() {
    let test_file = write_test_file(&["reader.js"], "import './reader.js';\n");
    let files = [
        (TEST_FILE, test_file.as_str()),
        (
            "reader.js",
            "import { own as mine } from './barrel.js';\nexport const own = 1;\nconsole.log(mine);\n",
        ),
        ("barrel.js", "export * from './reader.js';\n"),
    ];
    with_test_run_graph(&files, |graph, input| {
        let reader = file_named(input, "reader.js");
        let own = input.files.atoms.intern(b"own");
        let asked = (file_named(input, "barrel.js"), own);
        let by_itself = find_way_to_declaration(graph, Some(reader), asked);
        assert_eq!(describe(input, &by_itself), ["declaration"]);
        let by_another = find_way_to_declaration(graph, None, asked);
        assert!(has_station(&by_another));
    });
}

#[test]
fn commonjs_file_behind_its_face_is_a_station_with_its_declaration_below_it() {
    let rest = "import { flag } from './barrel.js';\nconsole.log(flag);\n";
    let test_file = write_test_file(&["dep.cjs"], rest);
    let files = [
        (TEST_FILE, test_file.as_str()),
        ("barrel.js", "export * from './dep.cjs';\n"),
        ("dep.cjs", "exports.flag = 'real';\n"),
    ];
    with_test_run_graph(&files, |graph, input| {
        let reader = file_named(input, TEST_FILE);
        let binding = graph.import_binding(reader, symbol_named(input, reader, "flag"));
        let asked = (
            file_named(input, "barrel.js"),
            input.files.atoms.intern(b"flag"),
        );
        let steps = find_way_of_read(graph, reader, binding, Some(asked));
        let expected = [
            "dep.cjs flag by a star from barrel.js behind 2",
            "dep.cjs itself may have flag",
        ];
        assert_eq!(describe(input, &steps), expected);
    });
}

#[test]
fn statements_are_kept_where_a_mock_may_stand_and_nowhere_else() {
    let others = [
        (
            "barrel.js",
            "export * from './plain.js';\nexport * from './inner.js';\nexport { a as b } from './lib.js';\n",
        ),
        ("plain.js", "export const plain = 1;\n"),
        ("inner.js", "export { fn } from './lib.js';\n"),
        ("lib.js", "export const a = 1;\nexport const fn = 2;\n"),
    ];
    let rest = "import * as all from './barrel.js';\nconsole.log(all);\n";
    let cases: [&[&str]; 2] = [&["lib.js"], &[]];
    for mocked in cases {
        let test_file = write_test_file(mocked, rest);
        let mut files = vec![(TEST_FILE, test_file.as_str())];
        files.extend_from_slice(&others);
        with_test_run_graph(&files, |graph, input| {
            let names = ["barrel.js", "inner.js", "lib.js"];
            let [barrel, inner, lib] = names.map(|name| file_named(input, name));
            let atoms = &input.files.atoms;
            let [a, b, brought] = ["a", "b", "fn"].map(|name| atoms.intern(name.as_bytes()));
            let is_mocked = !mocked.is_empty();
            let handed_on = is_mocked.then_some((ModuleRef::File(lib), a));
            assert_eq!(graph.find_what_hands_on_names(barrel, b), handed_on);
            assert_eq!(graph.find_what_hands_on_names(barrel, a), None);
            let named = if is_mocked { vec![inner] } else { Vec::new() };
            assert_eq!(graph.files_named_by_stars(barrel), named);
            assert_eq!(graph.is_brought_by_star(barrel, brought), is_mocked);
            assert!(!graph.is_brought_by_star(barrel, b));
            assert_eq!(graph.reaches_mock(barrel), is_mocked);
        });
    }
}

#[test]
fn program_that_mocks_no_file_has_no_station() {
    let files = [
        (
            "barrel.js",
            "export * from './first.js';\nexport * from './lib.js';\n",
        ),
        ("first.js", "export const other = 1;\n"),
        LIB,
    ];
    assert_eq!(find_way(&[], &files, ("barrel.js", "fn")), [""; 0]);
    assert_eq!(find_stations(&[], READS_FN, &files), [""; 0]);
    let mut beside = files.to_vec();
    beside.push(("elsewhere.js", "export const far = 1;\n"));
    assert_eq!(
        find_way(&["elsewhere.js"], &beside, ("barrel.js", "fn")),
        [""; 0]
    );
    let reads = "import './elsewhere.js';\nimport { fn } from './barrel.js';\nconsole.log(fn);\n";
    assert_eq!(find_stations(&["elsewhere.js"], reads, &beside), [""; 0]);
}

#[test]
fn name_read_off_what_require_gives_is_asked_of_the_file_that_is_required() {
    let others = [
        ("declares.js", "export const v = 'real';\n"),
        ("mocked.js", "export { v } from './declares.js';\n"),
        ("barrel.js", "export { v } from './mocked.js';\n"),
    ];
    let find = |rest: &str| find_stations(&["mocked.js"], rest, &others);
    let by_import = find("import * as all from './barrel.js';\nconsole.log(all.v);\n");
    assert_eq!(by_import, ["mocked.js seen by barrel.js"]);
    for rest in [
        "console.log(require('./barrel.js').v);\n",
        "const all = require('./barrel.js');\nconsole.log(all.v);\n",
        "const { v } = require('./barrel.js');\nconsole.log(v);\n",
        "const { v: inner = 'none' } = require('./barrel.js');\nconsole.log(inner);\n",
    ] {
        assert_eq!(find(rest), by_import, "{rest}");
    }
}

#[test]
fn barrel_keeps_the_namespace_that_a_member_read_takes_off_it() {
    let rest = "console.log(require('./barrel.js').all.v);\n";
    let test_file = write_test_file(&["declares.cjs"], rest);
    let program = link_test_run(&[
        (TEST_FILE, test_file.as_str()),
        ("declares.cjs", "exports.v = 'real';\n"),
        ("barrel.js", "export * as all from './declares.cjs';\n"),
    ]);
    let printed = print_program(&program);
    let mut records = printed.lines().filter(|line| line.starts_with("module "));
    let barrel = records.find(|line| line.contains("path=\"/project/barrel.js\""));
    let barrel = barrel.expect("the barrel has a record");
    assert!(barrel.contains("name=\"all\""), "{barrel}");
}

#[test]
fn name_of_a_commonjs_file_read_off_a_barrel_is_asked_of_the_barrel() {
    let others = [
        ("declares.cjs", "exports.v = 'real';\n"),
        ("mocked.js", "export { v } from './declares.cjs';\n"),
        ("barrel.js", "export { v } from './mocked.js';\n"),
    ];
    for rest in [
        "import * as all from './barrel.js';\nconsole.log(all.v);\n",
        "console.log(require('./barrel.js').v);\n",
    ] {
        let stations = find_stations(&["mocked.js"], rest, &others);
        assert_eq!(stations, ["mocked.js seen by barrel.js"], "{rest}");
    }
}

#[test]
fn name_of_a_commonjs_file_that_a_star_brings_is_asked_of_the_stars() {
    let others = [
        ("declares.cjs", "exports.v = 'real';\n"),
        ("mocked.js", "export { v } from './declares.cjs';\n"),
        ("barrel.js", "export * from './mocked.js';\n"),
    ];
    let way = find_way(&["mocked.js"], &others, ("barrel.js", "v"));
    let expected = [
        "mocked.js v by a star from barrel.js behind 2",
        "declaration",
    ];
    assert_eq!(way, expected);
}

#[test]
fn name_read_off_a_namespace_that_a_barrel_hands_on_is_asked_in_the_name_of_the_barrel() {
    for (declares, text) in [
        ("declares.cjs", "exports.v = 'real';\n"),
        ("declares.js", "export const v = 'real';\n"),
    ] {
        let barrel = format!("export * as all from './{declares}';\n");
        let others = [(declares, text), ("barrel.js", barrel.as_str())];
        for rest in [
            "import { all } from './barrel.js';\nconsole.log(all.v);\n",
            "import * as barrel from './barrel.js';\nconsole.log(barrel.all.v);\n",
        ] {
            let stations = find_stations(&[declares], rest, &others);
            let expected = format!("{declares} seen by barrel.js");
            assert!(!stations.is_empty(), "{declares}: {rest}");
            assert!(
                stations.iter().all(|it| *it == expected),
                "{declares}: {rest}: {stations:?}"
            );
        }
    }
}

#[test]
fn star_over_a_mocked_barrel_lists_the_name_that_the_barrel_leaves_to_its_stars() {
    let rest = "console.log((await import('./barrel.js')).v);\n";
    let test_file = write_test_file(&["mocked.js"], rest);
    let program = link_test_run(&[
        (TEST_FILE, test_file.as_str()),
        ("declares.cjs", "exports.v = 'real';\n"),
        ("other.js", "export const other = 1;\n"),
        (
            "mocked.js",
            "export * from './other.js';\nexport { v } from './declares.cjs';\n",
        ),
        ("barrel.js", "export * from './mocked.js';\n"),
    ]);
    let printed = print_program(&program);
    let mut records = printed.lines().filter(|line| line.starts_with("module "));
    let barrel = records.find(|line| line.contains("path=\"/project/barrel.js\""));
    let barrel = barrel.expect("the barrel has a record");
    let step = "name=\"v\" mayBeAbsent=true exportName=\"v\" specifier=\"./mocked.js\"";
    assert!(barrel.contains(step), "{barrel}");
}

#[test]
fn name_read_off_an_object_that_another_object_shows_is_asked_of_its_module() {
    let others = [
        ("declares.js", "export const v = 'real';\n"),
        ("mocked.js", "export { v } from './declares.js';\n"),
        ("barrel.js", "export * as inner from './mocked.js';\n"),
    ];
    let find = |rest: &str| find_stations(&["mocked.js"], rest, &others);
    let by_name = find("import { inner } from './barrel.js';\nconsole.log(inner.v);\n");
    assert_eq!(by_name, ["mocked.js seen by barrel.js"]);
    for rest in [
        "import * as all from './barrel.js';\nconsole.log(all.inner.v);\n",
        "console.log(require('./barrel.js').inner.v);\n",
        "const all = require('./barrel.js');\nconsole.log(all.inner.v);\n",
    ] {
        assert_eq!(find(rest), by_name, "{rest}");
    }
}

#[test]
fn object_of_a_module_that_may_be_mocked_is_asked_for_in_the_name_of_its_importer() {
    let rest = "import * as all from './mocked.js';\nconsole.log(Object.keys(all));\n";
    let test_file = write_test_file(&["mocked.js"], rest);
    let files = [
        (TEST_FILE, test_file.as_str()),
        ("mocked.js", "export const v = 'real';\n"),
    ];
    let printed = print_program(&link_test_run(&files));
    let asks: Vec<&str> = (printed.lines())
        .filter(|line| line.contains(" = NamespaceSeenBy "))
        .collect();
    assert_eq!(asks.len(), 1, "{printed}");
    assert!(asks[0].contains("referrer=m"), "{}", asks[0]);
}

fn write_chain(count: usize) -> Vec<(String, String)> {
    let mut files: Vec<(String, String)> = (0..count)
        .map(|index| {
            let next = match index + 1 == count {
                true => String::from("lib.js"),
                false => format!("b{}.js", index + 1),
            };
            (
                format!("b{index}.js"),
                format!("export * from './{next}';\n"),
            )
        })
        .collect();
    files.push((LIB.0.to_owned(), LIB.1.to_owned()));
    files
}

#[test]
fn chain_of_barrels_has_a_step_for_each_file() {
    for count in [75, 300] {
        let files = write_chain(count);
        let others: Vec<(&str, &str)> = files.iter().map(|it| (&*it.0, &*it.1)).collect();
        let mocked: Vec<&str> = others.iter().map(|it| it.0).collect();
        let way = find_way(&mocked, &others, ("b0.js", "fn"));
        assert_eq!(way.len(), count + 2);
        let behind = count + 2;
        assert_eq!(
            way[0],
            format!("b0.js fn by the statement from the reader behind {behind}")
        );
        assert_eq!(
            way[1],
            format!("b1.js fn by a star from b0.js behind {behind}")
        );
        let last = count - 1;
        assert_eq!(
            way[count],
            format!("lib.js fn by a star from b{last}.js behind {behind}")
        );
        assert_eq!(way[count + 1], "declaration");
        assert_eq!(
            find_way(&["lib.js"], &others, ("b0.js", "fn")),
            [
                format!("lib.js fn by a star from b{last}.js behind 2"),
                String::from("declaration")
            ]
        );
    }
}

#[test]
fn stars_that_meet_again_behind_a_fork_are_asked_once() {
    const LEVELS: usize = 40;
    let mut files: Vec<(String, String)> = Vec::new();
    for level in 0..LEVELS {
        let text = match level + 1 == LEVELS {
            true => String::from("export * from './lib.js';\n"),
            false => {
                let next = level + 1;
                format!("export * from './l{next}a.js';\nexport * from './l{next}b.js';\n")
            }
        };
        files.push((format!("l{level}a.js"), text.clone()));
        files.push((format!("l{level}b.js"), text));
    }
    files.push((LIB.0.to_owned(), LIB.1.to_owned()));
    let others: Vec<(&str, &str)> = files.iter().map(|it| (&*it.0, &*it.1)).collect();
    let last = LEVELS - 1;
    assert_eq!(
        find_way(&["lib.js"], &others, ("l0a.js", "fn")),
        [
            format!("lib.js fn by a star from l{last}a.js behind 2"),
            String::from("declaration"),
            format!("lib.js fn by a star from l{last}b.js behind 4"),
            String::from("declaration")
        ]
    );
}
