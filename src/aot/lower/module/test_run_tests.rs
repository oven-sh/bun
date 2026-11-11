use super::test_run_ways::{
    AskedBy, KeptBetweenWays, Step, find_file_that_asks_mock, find_way_of_read,
    find_way_to_declaration, has_station,
};
use crate::compile::link_program;
use crate::compile::testing::{BUNDLED_LIBS, TestProject, default_settings, describe_messages};
use crate::ir::parallel::run_serially;
use crate::ir::{Program, print_program};
use crate::load::source_provider::WithoutServices;
use crate::modules::testing::{bind_whole_program, file_named, symbol_named, with_test_run_graph};
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
        Step::FileItself { file, name, .. } => {
            let file = name_of(input, file);
            let name = String::from_utf8_lossy(input.files.atoms.bytes(name)).into_owned();
            format!("{file} itself is asked for {name}")
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
        describe(
            input,
            &find_way_to_declaration(graph, None, Some(reader), asked),
        )
    })
}

fn assert_what_is_kept_changes_no_way(mocked: &[&str], others: &[(&str, &str)], top: &str) {
    let imports = format!("import * as all from './{top}';\nconsole.log(all);\n");
    let test_file = write_test_file(mocked, &imports);
    let mut files = vec![(TEST_FILE, test_file.as_str())];
    files.extend_from_slice(others);
    with_test_run_graph(&files, |graph, input| {
        let mut kept = KeptBetweenWays::default();
        let mut kept_from_the_top = KeptBetweenWays::default();
        let mut kept_from_the_bottom = KeptBetweenWays::default();
        let files = others.iter().map(|(name, _)| file_named(input, name));
        let files: Vec<FileId> = files.filter(|&file| graph.has_record(file)).collect();
        for &file in &files {
            for export in graph.exports(file) {
                let asked = (file, export.name);
                let alone = describe(input, &find_way_to_declaration(graph, None, None, asked));
                let beside_others = find_way_to_declaration(graph, Some(&mut kept), None, asked);
                assert_eq!(
                    alone,
                    describe(input, &beside_others),
                    "{}",
                    name_of(input, file)
                );
            }
        }
        for (files, kept) in [
            (files.clone(), &mut kept_from_the_top),
            (
                files.iter().rev().copied().collect(),
                &mut kept_from_the_bottom,
            ),
        ] {
            for file in files {
                for export in graph.exports(file) {
                    let alone = &mut KeptBetweenWays::default();
                    let alone = find_file_that_asks_mock(graph, alone, file, export);
                    let beside_others = find_file_that_asks_mock(graph, kept, file, export);
                    assert_eq!(alone, beside_others, "{}", name_of(input, file));
                }
            }
        }
    })
}

#[test]
fn a_file_that_is_left_out_below_the_writer_is_told_nothing() {
    let imports = "import * as one from './aisle.mjs';\nimport * as two from './vault.mjs';\nconsole.log(one, two);\n";
    let test_file = write_test_file(&["store.cjs"], imports);
    let files = [
        (TEST_FILE, test_file.as_str()),
        (
            "aisle.mjs",
            "export * from './label.mjs';\nexport const a = 1;\n",
        ),
        (
            "vault.mjs",
            "export * from './label.mjs';\nexport const b = 1;\n",
        ),
        (
            "label.mjs",
            "export { count as first } from './store.cjs';\n",
        ),
        ("store.cjs", "exports.count = 1;\n"),
    ];
    with_test_run_graph(&files, |_, input| {
        let mut graph = bind_whole_program(input);
        let file = |name: &str| file_named(input, name);
        graph.leave_out_files(&[file("label.mjs")], &run_serially);
        assert!(graph.is_left_out(ModuleRef::File(file("label.mjs"))));
        let first = input.files.atoms.intern(b"first");
        for holders in [["aisle.mjs", "vault.mjs"], ["vault.mjs", "aisle.mjs"]] {
            let mut kept = KeptBetweenWays::default();
            for holder in holders.map(file) {
                let export = graph.exports(holder).iter().find(|it| it.name == first);
                let export = export.expect("the star brings the name");
                let writer = find_file_that_asks_mock(&graph, &mut kept, holder, export);
                assert_eq!(writer, Some(holder), "{}", name_of(input, holder));
            }
        }
    })
}

#[test]
fn a_writer_found_beside_others_is_the_writer_found_alone() {
    let imports = "import * as one from './top.mjs';\nimport * as two from './other.mjs';\nconsole.log(one, two);\n";
    let test_file = write_test_file(&["store.cjs"], imports);
    let files = [
        (TEST_FILE, test_file.as_str()),
        ("top.mjs", "export * from './mid.mjs';\n"),
        ("mid.mjs", "export * from './gap.mjs';\n"),
        ("other.mjs", "export * from './gap.mjs';\n"),
        ("gap.mjs", "export * from './deep.mjs';\n"),
        ("deep.mjs", "export * from './label.mjs';\n"),
        (
            "label.mjs",
            "export { count as first } from './store.cjs';\n",
        ),
        ("store.cjs", "exports.count = 1;\n"),
    ];
    with_test_run_graph(&files, |_, input| {
        let mut graph = bind_whole_program(input);
        let file = |name: &str| file_named(input, name);
        graph.leave_out_files(&[file("gap.mjs"), file("label.mjs")], &run_serially);
        let first = input.files.atoms.intern(b"first");
        let mut holders = ["top.mjs", "other.mjs", "mid.mjs", "deep.mjs"].map(file);
        for _ in 0..holders.len() {
            let mut kept = KeptBetweenWays::default();
            for holder in holders {
                let export = graph.exports(holder).iter().find(|it| it.name == first);
                let export = export.expect("the star brings the name");
                let writer = find_file_that_asks_mock(&graph, &mut kept, holder, export);
                assert_eq!(writer, Some(file("deep.mjs")), "{}", name_of(input, holder));
            }
            holders.rotate_left(1);
        }
    })
}

#[test]
fn a_chain_of_stars_tells_every_file_on_it_who_wrote_the_name() {
    let mut files: Vec<(String, String)> = (0..9)
        .map(|link| {
            (
                format!("m{link}.mjs"),
                format!("export * from './m{}.mjs';\n", link + 1),
            )
        })
        .collect();
    files.push((
        String::from("m9.mjs"),
        String::from("export { x as y, x } from './last.mjs';\n"),
    ));
    files.push((
        String::from("last.mjs"),
        String::from("export const x = 1;\n"),
    ));
    let with_a_ring = {
        let mut files = files.clone();
        files[4].1.insert_str(0, "export * from './m1.mjs';\n");
        files
    };
    let with_a_mock_on_the_way = files.clone();
    for (files, mocked) in [
        (&files, &["last.mjs"][..]),
        (&with_a_ring, &["last.mjs"][..]),
        (&with_a_mock_on_the_way, &["last.mjs", "m6.mjs"][..]),
    ] {
        let files: Vec<(&str, &str)> = files
            .iter()
            .map(|(name, text)| (name.as_str(), text.as_str()))
            .collect();
        assert_what_is_kept_changes_no_way(mocked, &files, "m0.mjs");
    }
}

#[test]
fn what_is_kept_between_the_ways_of_a_wide_barrel_changes_no_way() {
    let mut files: Vec<(String, String)> = vec![
        (
            String::from("part.mjs"),
            (0..12)
                .map(|n| format!("export const n{n} = {n};\n"))
                .collect(),
        ),
        (
            String::from("loose.cjs"),
            String::from("exports.n3 = 'loose';\nexports.own = 1;\n"),
        ),
        (
            String::from("ring.mjs"),
            String::from("export * from './barrel.mjs';\nexport const ringed = 1;\n"),
        ),
        (
            String::from("deep.mjs"),
            String::from("export * from './s1.mjs';\nexport * from './part.mjs';\n"),
        ),
        (
            String::from("free.mjs"),
            String::from("export const free = 1;\n"),
        ),
    ];
    for star in 0..6 {
        let names = format!("n{}, n{} as again{star}", star * 2, star * 2 + 1);
        files.push((
            format!("s{star}.mjs"),
            format!("export {{ {names} }} from './part.mjs';\n"),
        ));
    }
    let stars = [
        "free.mjs", "s0.mjs", "ring.mjs", "s1.mjs", "s2.mjs", "deep.mjs", "s3.mjs", "s4.mjs",
        "s5.mjs",
    ];
    let write = |stars: &[&str]| -> String {
        stars
            .iter()
            .map(|name| format!("export * from './{name}';\n"))
            .collect()
    };
    let statements_alone = [
        "free.mjs", "s0.mjs", "s1.mjs", "s2.mjs", "s3.mjs", "s4.mjs", "s5.mjs",
    ];
    for (stars, with_commonjs) in [
        (&statements_alone[..], false),
        (&stars[..], false),
        (&stars[..], true),
    ] {
        let mut stars = stars.to_vec();
        if with_commonjs {
            stars.insert(4, "loose.cjs");
        }
        let mut files = files.clone();
        files.push((String::from("barrel.mjs"), write(&stars)));
        files.push((
            String::from("top.mjs"),
            String::from("export * from './barrel.mjs';\n"),
        ));
        let files: Vec<(&str, &str)> = files
            .iter()
            .map(|(name, text)| (name.as_str(), text.as_str()))
            .collect();
        assert_what_is_kept_changes_no_way(&["part.mjs"], &files, "top.mjs");
        assert_what_is_kept_changes_no_way(&["part.mjs", "s2.mjs"], &files, "top.mjs");
        assert_what_is_kept_changes_no_way(&["deep.mjs"], &files, "top.mjs");
    }
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
        let asks_for_names = line.contains("thatKeepsNamesOfOriginal");
        if is_in_test_file && line.contains(" = SeesMockOf ") && !asks_for_names {
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
        let by_itself = find_way_to_declaration(graph, None, Some(reader), asked);
        assert_eq!(describe(input, &by_itself), ["declaration"]);
        let by_another = find_way_to_declaration(graph, None, None, asked);
        assert!(has_station(&by_another));
    });
}

#[test]
fn module_behind_facade_is_station() {
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
        let steps = find_way_of_read(graph, None, reader, binding, Some(asked));
        let expected = [
            "dep.cjs flag by a star from barrel.js behind 2",
            "dep.cjs itself may have flag",
        ];
        assert_eq!(describe(input, &steps), expected);
    });
}

#[test]
fn what_is_kept_changes_the_way_of_no_read_off_a_barrel() {
    let found_at_the_run = ["m0", "m1", "m2", "m3"];
    let declared = ["n0", "n3", "n7", "n11"];
    let names = [&found_at_the_run[..], &declared[..], &["nowhere"][..]].concat();
    let rest = format!(
        "import {{ {} }} from './barrel.mjs';\nconsole.log({});\n",
        names.join(", "),
        names.join(", ")
    );
    let parts: Vec<(String, String)> = (0..12)
        .map(|part| {
            (
                format!("f{part}.mjs"),
                format!("export const n{part} = {part};\n"),
            )
        })
        .collect();
    let stars: String = (0..12)
        .map(|part| format!("export * from './f{part}.mjs';\n"))
        .collect();
    let barrel = format!("{stars}export * from './more.cjs';\nexport * from './third.cjs';\n");
    for mocked in [
        &["f7.mjs"][..],
        &["f0.mjs", "more.cjs"][..],
        &["f11.mjs", "f3.mjs"][..],
    ] {
        let test_file = write_test_file(mocked, &rest);
        let mut files = vec![
            (TEST_FILE, test_file.as_str()),
            ("barrel.mjs", barrel.as_str()),
            (
                "more.cjs",
                "for (let i = 0; i < 4; i++) exports['m' + i] = i;\n",
            ),
            ("third.cjs", "exports[['oth', 'er'].join('')] = 1;\n"),
        ];
        files.extend(
            parts
                .iter()
                .map(|(name, text)| (name.as_str(), text.as_str())),
        );
        with_test_run_graph(&files, |graph, input| {
            let reader = file_named(input, TEST_FILE);
            let barrel = file_named(input, "barrel.mjs");
            let way = |kept: Option<&mut KeptBetweenWays>, name: &str| {
                let binding = graph.import_binding(reader, symbol_named(input, reader, name));
                let asked = (barrel, input.files.atoms.intern(name.as_bytes()));
                describe(
                    input,
                    &find_way_of_read(graph, kept, reader, binding, Some(asked)),
                )
            };
            let alone: Vec<Vec<String>> = names.iter().map(|name| way(None, name)).collect();
            assert!(alone.iter().any(|steps| steps.len() > 1), "{mocked:?}");
            let mut kept_from_the_first = KeptBetweenWays::default();
            let mut kept_from_the_last = KeptBetweenWays::default();
            for (name, alone) in names.iter().zip(&alone) {
                assert_eq!(
                    *alone,
                    way(Some(&mut kept_from_the_first), name),
                    "{mocked:?} {name}"
                );
            }
            for (name, alone) in names.iter().zip(&alone).rev() {
                assert_eq!(
                    *alone,
                    way(Some(&mut kept_from_the_last), name),
                    "{mocked:?} {name}"
                );
            }
        });
    }
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
fn mock_is_asked_from_the_file_that_wrote_the_statement_past_rings_dead_ends_and_imports() {
    let part = ("part.cjs", "exports.kept = 1;\n");
    let inner = ("inner.mjs", "export { kept as early } from './part.cjs';\n");
    let witness = (
        "witness.mjs",
        "export { kept as early } from './part.cjs';\n",
    );
    let star = |names: &[&str]| -> String {
        names
            .iter()
            .map(|name| format!("export * from './{name}';\n"))
            .collect()
    };
    let cells: Vec<(&str, Vec<(&str, String)>)> = vec![
        (
            "a chain",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "part.cjs"])),
                ("mid.mjs", star(&["inner.mjs"])),
            ],
        ),
        (
            "a ring with the way back in front",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "part.cjs"])),
                ("mid.mjs", star(&["barrel.mjs", "inner.mjs"])),
            ],
        ),
        (
            "a dead end in front",
            vec![
                ("barrel.mjs", star(&["tail.mjs", "mid.mjs", "part.cjs"])),
                ("tail.mjs", star(&["barrel.mjs"])),
                ("mid.mjs", star(&["inner.mjs"])),
            ],
        ),
        (
            "a ring whose import stands in front of the writer",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "part.cjs"])),
                (
                    "mid.mjs",
                    format!(
                        "{}import './witness.mjs';\n{}",
                        star(&["barrel.mjs"]),
                        star(&["inner.mjs"])
                    ),
                ),
            ],
        ),
        (
            "no ring and an import in front of the star",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "part.cjs"])),
                (
                    "mid.mjs",
                    format!("import './witness.mjs';\n{}", star(&["inner.mjs"])),
                ),
            ],
        ),
        (
            "a side ring and an import behind the star",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "inner.mjs", "part.cjs"])),
                (
                    "mid.mjs",
                    format!("{}import './witness.mjs';\n", star(&["side.mjs"])),
                ),
                ("side.mjs", star(&["barrel.mjs"])),
            ],
        ),
        (
            "a file in front stars the barrel and the mocked file itself",
            vec![
                ("barrel.mjs", star(&["tail.mjs", "mid.mjs"])),
                ("tail.mjs", star(&["barrel.mjs", "part.cjs"])),
                ("mid.mjs", star(&["inner.mjs"])),
            ],
        ),
        (
            "a statement between the star and the writer",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "part.cjs"])),
                (
                    "mid.mjs",
                    String::from("export { early } from './inner.mjs';\n"),
                ),
            ],
        ),
        (
            "a side ring in front of the writer",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "part.cjs"])),
                ("mid.mjs", star(&["side.mjs", "inner.mjs"])),
                ("side.mjs", star(&["mid.mjs"])),
            ],
        ),
        (
            "the same behind an import",
            vec![
                ("barrel.mjs", star(&["mid.mjs", "part.cjs"])),
                (
                    "mid.mjs",
                    format!(
                        "import './witness.mjs';\n{}",
                        star(&["side.mjs", "inner.mjs"])
                    ),
                ),
                ("side.mjs", star(&["mid.mjs"])),
            ],
        ),
    ];
    for (cell, files) in &cells {
        let mut files: Vec<(&str, &str)> = files
            .iter()
            .map(|(name, text)| (*name, text.as_str()))
            .collect();
        files.extend([part, inner, witness]);
        let way = find_way(&["part.cjs"], &files, ("barrel.mjs", "early"));
        let stations: Vec<&String> = way
            .iter()
            .filter(|step| step.starts_with("part.cjs kept "))
            .collect();
        assert_eq!(stations.len(), 1, "{cell}: {way:?}");
        assert!(stations[0].contains(" from inner.mjs "), "{cell}: {way:?}");
        assert_what_is_kept_changes_no_way(&["part.cjs"], &files, "barrel.mjs");
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

fn find_way_through_layers_that_are_all_mocked(levels: usize) -> Vec<String> {
    let mut files: Vec<(String, String)> = Vec::new();
    for level in 0..levels {
        let text = match level + 1 == levels {
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
    let mocked: Vec<&str> = files.iter().map(|it| &*it.0).collect();
    find_way(&mocked, &others, ("l0a.js", "fn"))
}

#[test]
fn what_lies_behind_a_station_that_holds_another_is_written_out_once() {
    assert_eq!(
        find_way_through_layers_that_are_all_mocked(3),
        [
            "l0a.js fn by the statement from the reader behind 13",
            "l1a.js fn by a star from l0a.js behind 8",
            "l2a.js fn by a star from l1a.js behind 5",
            "lib.js fn by a star from l2a.js behind 5",
            "declaration",
            "l2b.js fn by a star from l1a.js behind 8",
            "lib.js fn by a star from l2b.js behind 8",
            "declaration",
            "l1b.js fn by a star from l0a.js behind 13",
            "l2a.js fn by a star from l1b.js behind 11",
            "l2a.js itself is asked for fn",
            "l2b.js fn by a star from l1b.js behind 13",
            "l2b.js itself is asked for fn",
        ]
    );
    assert_eq!(
        find_way_through_layers_that_are_all_mocked(40).len(),
        6 * 40 - 5
    );
}

fn find_way_through_diamonds(levels: usize, is_mocked: impl Fn(&str) -> bool) -> Vec<String> {
    let mut files = vec![(
        String::from("leaf.cjs"),
        String::from("exports[['f', 'n'].join('')] = 1;\n"),
    )];
    for level in 0..levels {
        let is_last = level + 1 == levels;
        let text = match is_last {
            true => String::from("export * from './leaf.cjs';\n"),
            false => format!("export * from './l{level}.js';\nexport * from './r{level}.js';\n"),
        };
        files.push((format!("b{level}.js"), text));
        if !is_last {
            let text = format!("export {{ fn }} from './b{}.js';\n", level + 1);
            files.push((format!("l{level}.js"), text.clone()));
            files.push((format!("r{level}.js"), text));
        }
    }
    let others: Vec<(&str, &str)> = files.iter().map(|it| (&*it.0, &*it.1)).collect();
    let mocked = others.iter().map(|it| it.0);
    let mocked: Vec<&str> = mocked.filter(|name| is_mocked(name)).collect();
    find_way(&mocked, &others, ("b0.js", "fn"))
}

#[test]
fn diamond_steps_are_linear() {
    let are_barrels = |name: &str| name.starts_with('b');
    let are_left = |name: &str| name.starts_with('l') && name != "leaf.cjs";
    let are_sides = |name: &str| are_left(name) || name.starts_with('r');
    let shapes: [&dyn Fn(&str) -> bool; 6] = [
        &are_barrels,
        &are_left,
        &are_sides,
        &|name| name == "b0.js",
        &|name| are_barrels(name) || are_left(name),
        &|name| are_barrels(name) || are_sides(name),
    ];
    for (shape, is_mocked) in shapes.into_iter().enumerate() {
        let steps = |levels: usize| find_way_through_diamonds(levels, is_mocked).len();
        let (ten, twenty, forty) = (steps(10), steps(20), steps(40));
        assert_eq!(
            forty - twenty,
            2 * (twenty - ten),
            "{shape}: {ten} {twenty} {forty}"
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
