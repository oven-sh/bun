use super::*;
use crate::modules::module_set::collect_modules;
use crate::modules::requests::scan_files;
use crate::modules::testing::{file_named, with_graph};

type Sources<'n> = [(&'n str, &'n str)];

fn with_order<R>(
    files: &Sources<'_>,
    check: impl FnOnce(&BindInput<'_, '_>, &EvaluationOrder, &PlannedSites) -> R,
) -> R {
    with_graph(files, |_, input| {
        let scans = scan_files(input);
        let modules = collect_modules(input, &scans);
        let (order, sites) = compute_order(input, &scans, &modules);
        check(input, &order, &sites)
    })
}

fn sites_of_first<T>(files: &Sources<'_>, read: impl Fn(&PlannedSite) -> T) -> Vec<T> {
    with_order(files, |input, _, sites| {
        let sites = sites.of(file_named(input, files[0].0)).iter();
        sites.map(read).collect()
    })
}

fn files_that<'n>(
    files: &Sources<'n>,
    has: impl Fn(&EvaluationOrder, ModuleRef) -> bool,
) -> Vec<&'n str> {
    with_order(files, |input, order, _| {
        let names = files.iter().map(|file| file.0);
        names
            .filter(|name| has(order, ModuleRef::File(file_named(input, name))))
            .collect()
    })
}

fn half<'n>(files: &Sources<'n>) -> Vec<&'n str> {
    files_that(files, EvaluationOrder::half)
}

const LEAF: (&str, &str) = ("leaf.cjs", "exports.x = 1;");

fn assert_position(expected: SitePosition, sources: &[&str]) {
    for &source in sources {
        let positions = sites_of_first(&[("main.cjs", source), LEAF], |site| site.position);
        assert_eq!(positions, [expected], "{source}");
    }
}

#[test]
fn code_that_every_run_passes_is_in_order() {
    let sources = [
        "require('./leaf.cjs');",
        "const a = require('./leaf.cjs');",
        "var { x } = require('./leaf.cjs');",
        "exports.y = require('./leaf.cjs').x + 1;",
        "{ const a = require('./leaf.cjs'); }",
        "if (require('./leaf.cjs').x) exports.y = 1;",
        "exports.y = [{ z: require('./leaf.cjs') }];",
        "exports.y = require('./leaf.cjs') || 1;",
        "exports.y = require('./leaf.cjs')?.x;",
        "module.require('./leaf.cjs');",
        "if (exports.never) throw new Error(); require('./leaf.cjs');",
        "let a, b; a = b = require('./leaf.cjs');",
        "let a; [a] = [require('./leaf.cjs')];",
        "let a; ({ a } = { a: require('./leaf.cjs') });",
        "let a; exports.y = { z: a = require('./leaf.cjs') };",
        "let a; exports.y = [a = require('./leaf.cjs')];",
        "[require('./leaf.cjs').x = 1] = [];",
    ];
    assert_position(SitePosition::InOrder, &sources);
}

#[test]
fn code_that_a_run_may_skip_is_not_in_order() {
    let sources = [
        "if (exports.y) require('./leaf.cjs');",
        "exports.y = exports.z ? require('./leaf.cjs') : 1;",
        "exports.y = exports.z && require('./leaf.cjs');",
        "exports.y = exports.z || require('./leaf.cjs');",
        "exports.y = exports.z ?? require('./leaf.cjs');",
        "exports.y ||= require('./leaf.cjs');",
        "exports.y = exports.z?.[require('./leaf.cjs').x];",
        "exports.y = exports.z?.(require('./leaf.cjs'));",
        "for (const k of []) require('./leaf.cjs');",
        "while (exports.y) require('./leaf.cjs');",
        "out: { if (exports.y) break out; require('./leaf.cjs'); }",
        "switch (exports.y) { default: }; (() => require('./leaf.cjs'))();",
        "(function () { require('./leaf.cjs'); })();",
        "(function named() { require('./leaf.cjs'); })();",
        "if (exports.y) return; require('./leaf.cjs');",
        "{ using r = exports.y; require('./leaf.cjs'); }",
        "require?.('./leaf.cjs');",
        "require.call(null, './leaf.cjs');",
        "const r = require; r('./leaf.cjs');",
        "require = exports.y; require('./leaf.cjs');",
        "let a; [a = require('./leaf.cjs')] = [1];",
        "let a; ({ a = require('./leaf.cjs') } = { a: 1 });",
        "let a; ({ y: a = require('./leaf.cjs') } = { y: 1 });",
        "let a; ({ y: [a = require('./leaf.cjs')] } = { y: [1] });",
        "let a; [a = exports.y = require('./leaf.cjs')] = [1];",
    ];
    assert_position(SitePosition::Sometimes, &sources);
}

#[test]
fn code_of_a_function_or_under_a_handler_is_late() {
    let sources = [
        "exports.f = function () { return require('./leaf.cjs'); };",
        "exports.f = () => require('./leaf.cjs');",
        "function f() { require('./leaf.cjs'); } f();",
        "try { require('./leaf.cjs'); } catch {}",
        "try {} catch { require('./leaf.cjs'); }",
        "try { (() => require('./leaf.cjs'))(); } catch {}",
        "(async () => require('./leaf.cjs'))();",
        "(function* () { require('./leaf.cjs'); })();",
        "(function again() { exports.f = again; require('./leaf.cjs'); })();",
        "(function again() { exports.f = () => again(); require('./leaf.cjs'); })();",
        "(function () { exports.f = arguments.callee; require('./leaf.cjs'); })();",
        "class C { static x = require('./leaf.cjs'); }",
        "class C { x = require('./leaf.cjs'); }",
        "exports.o = { get x() { return require('./leaf.cjs'); } };",
        "function f(a = require('./leaf.cjs')) {}",
    ];
    assert_position(SitePosition::Late, &sources);
}

#[test]
fn no_site_of_a_body_that_awaits_is_in_order() {
    let files = [("main.mjs", "require('./leaf.cjs'); await 0;"), LEAF];
    let positions = sites_of_first(&files, |site| site.position);
    assert_eq!(positions, [SitePosition::Sometimes]);
}

#[test]
fn a_chain_of_requires_is_seen_whole() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "require('./c.cjs');"),
        ("c.cjs", "exports.x = 1;"),
    ];
    assert!(half(&files).is_empty());
}

#[test]
fn the_modules_of_a_cycle_are_seen_half_done() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        (
            "a.cjs",
            "exports.first = 1; require('./b.cjs'); exports.second = 2;",
        ),
        (
            "b.cjs",
            "exports.seen = require('./a.cjs').second; require('./c.cjs');",
        ),
        ("c.cjs", "exports.x = 1;"),
    ];
    assert_eq!(half(&files), ["a.cjs", "b.cjs"]);
}

#[test]
fn a_module_that_requires_itself_is_seen_half_done() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        ("a.cjs", "require('./a.cjs');"),
    ];
    assert_eq!(half(&files), ["a.cjs"]);
}

#[test]
fn a_cycle_through_a_branch_counts() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "if (exports.y) require('./a.cjs');"),
    ];
    assert_eq!(half(&files), ["a.cjs", "b.cjs"]);
}

#[test]
fn a_cycle_of_imports_and_requires_counts() {
    let files = [
        ("main.mjs", "import './a.mjs';"),
        ("a.mjs", "import './b.cjs'; export const x = 1;"),
        ("b.cjs", "exports.x = require('./a.mjs').x;"),
    ];
    assert_eq!(half(&files), ["a.mjs", "b.cjs"]);
}

#[test]
fn what_a_late_site_may_run_is_exposed() {
    let files = [
        (
            "main.cjs",
            "exports.f = () => require('./a.cjs'); require('./c.cjs');",
        ),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "exports.x = 1;"),
        ("c.cjs", "exports.x = 1;"),
    ];
    assert_eq!(half(&files), ["a.cjs", "b.cjs"]);
}

#[test]
fn what_an_import_call_names_is_exposed() {
    let files = [
        ("main.cjs", "import('./a.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "exports.x = 1;"),
    ];
    assert_eq!(half(&files), ["a.cjs", "b.cjs"]);
}

#[test]
fn what_a_computed_require_may_name_is_exposed() {
    let files = [
        (
            "main.cjs",
            "module.exports = (name) => require(`./pages/${name}.js`);",
        ),
        ("pages/home.js", "exports.x = 1;"),
    ];
    assert_eq!(half(&files), ["pages/home.js"]);
}

#[test]
fn what_a_load_by_an_unknown_name_may_find_is_exposed() {
    let main = (
        "main.cjs",
        "require('./served.cjs'); require('./asker.cjs');",
    );
    let asker = (
        "asker.cjs",
        "exports.seen = typeof require('./served.cjs');",
    );
    let loads_by_unknown_name = [
        main,
        (
            "served.cjs",
            "console.log('./asker.cjs'); require(process.env.PLUG); module.exports = function () {};",
        ),
        asker,
    ];
    assert_eq!(
        half(&loads_by_unknown_name),
        ["main.cjs", "served.cjs", "asker.cjs"]
    );
    let only_spells = [
        main,
        (
            "served.cjs",
            "console.log('./asker.cjs'); module.exports = function () {};",
        ),
        asker,
    ];
    assert!(half(&only_spells).is_empty());
}

#[test]
fn the_main_entry_point_that_an_unknown_name_may_find_is_seen_half_done() {
    let main = (
        "main.cjs",
        "require('./asker.cjs'); module.exports = function () {};",
    );
    let page = ("pages/home.js", "exports.x = 1;");
    let rows: [(&str, &[&str]); 4] = [
        ("require(process.argv[1]);", &["main.cjs"]),
        (
            "require(require('node:path').resolve(process.argv[1]));",
            &["main.cjs"],
        ),
        (
            "require(`./pages/${process.argv[2]}.js`);",
            &["pages/home.js"],
        ),
        ("console.log(process.argv[1]);", &[]),
    ];
    for (asker, seen_half_done) in rows {
        let files = [main, ("asker.cjs", asker), page];
        assert_eq!(half(&files), seen_half_done, "{asker}");
    }
}

#[test]
fn the_main_entry_point_is_seen_half_done_where_a_package_is_left_out() {
    let files = [
        (
            "main.cjs",
            "require('./asker.cjs'); module.exports = function () {};",
        ),
        ("asker.cjs", "exports.x = 1;"),
    ];
    let packages = [b"left-out".to_vec()];
    let rows: [(&[Vec<u8>], bool, &[&str]); 3] = [
        (&packages, false, &["main.cjs"]),
        (&packages, true, &[]),
        (&[], false, &[]),
    ];
    for (external_packages, runs_tests, seen_half_done) in rows {
        with_graph(&files, |_, input| {
            let input = &BindInput {
                external_packages,
                runs_tests,
                ..*input
            };
            let scans = scan_files(input);
            let modules = collect_modules(input, &scans);
            let (order, _) = compute_order(input, &scans, &modules);
            let is_half = |name: &&str| order.half(ModuleRef::File(file_named(input, name)));
            let half: Vec<&str> = files.iter().map(|file| file.0).filter(is_half).collect();
            assert_eq!(half, seen_half_done, "in a test run: {runs_tests}");
        });
    }
}

#[test]
fn an_es_module_that_a_made_name_may_require_during_its_load_is_left_to_the_loader() {
    let all: &[&str] = &["main.cjs", "root.mjs", "asker.cjs", "asked.mjs"];
    let rows: [(&str, &[&str]); 3] = [
        ("require('./asked.mjs');", all),
        ("require(process.env.NONE || './asked.mjs');", all),
        ("require(process.env.NONE);", &[]),
    ];
    for (asker, left_to_loader) in rows {
        let files = [
            ("main.cjs", "require('./root.mjs');"),
            ("root.mjs", "import './asker.cjs'; import './asked.mjs';"),
            ("asker.cjs", asker),
            ("asked.mjs", "import asker from './asker.cjs'; asker;"),
        ];
        let found = with_order(&files, |input, order, _| {
            let marks = &order.parts.is_loaded_by_loader;
            let is_left = |name: &&str| marks[file_named(input, name).idx()];
            let names = files.iter().map(|file| file.0);
            names.filter(is_left).collect::<Vec<_>>()
        });
        assert_eq!(found, left_to_loader, "{asker}");
    }
}

#[test]
fn a_require_in_the_body_of_a_file_may_find_what_another_file_has_written() {
    let text = "globalThis.wanted = './asked.mjs';";
    let no_text = "globalThis.wanted = process.env.NONE;";
    let in_body = "require(globalThis.wanted);";
    let under_try = "try { require(globalThis.wanted); } catch {}";
    let in_function = "exports.load = name => require(name);";
    let rows = [
        (text, in_body, true),
        (text, under_try, true),
        (text, in_function, false),
        (no_text, in_body, false),
    ];
    for (lays_name, asker, expected) in rows {
        let main = format!("{lays_name} require('./root.mjs');");
        let files = [
            ("main.cjs", main.as_str()),
            ("root.mjs", "import './asker.cjs'; import './asked.mjs';"),
            ("asker.cjs", asker),
            ("asked.mjs", "import asker from './asker.cjs'; asker;"),
        ];
        with_order(&files, |input, order, _| {
            let marks = &order.parts.is_loaded_by_loader;
            for file in &files {
                let is_left = marks[file_named(input, file.0).idx()];
                assert_eq!(is_left, expected, "{}: {main} {asker}", file.0);
            }
        });
    }
}

#[test]
fn a_made_name_leaves_the_cycle_to_the_loader_where_every_file_is_found_by_name() {
    let files = [
        ("main.cjs", "require('./root.mjs');"),
        ("root.mjs", "import './asker.cjs'; import './asked.mjs';"),
        ("asker.cjs", "require(process.env.NONE || './asked.mjs');"),
        ("asked.mjs", "import asker from './asker.cjs'; asker;"),
    ];
    let packages = [b"left-out".to_vec()];
    let (text, no_text) = (files[2].1, "require(process.env.NONE);");
    let rows: [(&[Vec<u8>], bool, &str); 4] = [
        (&[], true, text),
        (&packages, false, text),
        (&[], true, no_text),
        (&packages, false, no_text),
    ];
    for (external_packages, runs_tests, asker) in rows {
        let files = [files[0], files[1], ("asker.cjs", asker), files[3]];
        with_graph(&files, |_, input| {
            let input = &BindInput {
                external_packages,
                files_are_named_out_of_sight: !runs_tests,
                runs_tests,
                helpers_of_tests_name_files: runs_tests,
                ..*input
            };
            let scans = scan_files(input);
            let modules = collect_modules(input, &scans);
            let (order, _) = compute_order(input, &scans, &modules);
            assert!(order.parts.texts_that_spell_files.is_none());
            let marks = &order.parts.is_loaded_by_loader;
            let is_left = |file: &(&str, &str)| marks[file_named(input, file.0).idx()];
            assert!(files.iter().all(is_left), "{asker}, tests: {runs_tests}");
            assert!(
                order.defers_cycles_to_loader(),
                "{asker}, tests: {runs_tests}"
            );
        });
    }
}

#[test]
fn a_site_in_a_branch_exposes_nothing() {
    let files = [
        ("main.cjs", "if (exports.y) require('./a.cjs');"),
        ("a.cjs", "exports.x = 1;"),
    ];
    assert!(half(&files).is_empty());
}

fn evaluates(files: &Sources<'_>) -> Vec<bool> {
    sites_of_first(files, |site| site.evaluates)
}

#[test]
fn the_loader_keeps_what_it_alone_can_load() {
    let awaits = [
        ("main.cjs", "require('./a.mjs');"),
        ("a.mjs", "import './b.mjs';"),
        ("b.mjs", "await 0;"),
    ];
    assert_eq!(evaluates(&awaits), [false]);
    let data = [("main.cjs", "require('./data.json');"), ("data.json", "{}")];
    assert_eq!(evaluates(&data), [false]);
    let library = [("main.cjs", "require('node:path');")];
    assert_eq!(evaluates(&library), [false]);
    let plain = [
        ("main.cjs", "require('./a.mjs'); require('./leaf.cjs');"),
        ("a.mjs", ""),
        LEAF,
    ];
    assert_eq!(evaluates(&plain), [true, true]);
}

#[test]
fn the_loader_keeps_an_es_module_that_may_be_seen_half_done() {
    let cycle = [
        (
            "first.mjs",
            "const second = require('./second.mjs'); export const name = 'first';",
        ),
        (
            "second.mjs",
            "const first = require('./first.mjs'); console.log(first.name);",
        ),
    ];
    assert_eq!(evaluates(&cycle), [false]);
    let late_cycle = [
        ("main.cjs", "exports.f = () => require('./a.mjs');"),
        ("a.mjs", "import './main.cjs'; export {};"),
    ];
    assert_eq!(evaluates(&late_cycle), [false]);
    let lazy = [
        ("main.cjs", "exports.f = () => require('./a.mjs');"),
        ("a.mjs", "export {};"),
    ];
    assert_eq!(evaluates(&lazy), [true]);
    let lazy_commonjs = [
        ("main.cjs", "exports.f = () => require('./leaf.cjs');"),
        LEAF,
    ];
    assert_eq!(evaluates(&lazy_commonjs), [true]);
}
