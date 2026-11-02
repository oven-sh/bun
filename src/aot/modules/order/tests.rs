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

// What `read` says of each site of the first file.
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

fn exposed<'n>(files: &Sources<'n>) -> Vec<&'n str> {
    files_that(files, EvaluationOrder::exposed)
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
    assert!(exposed(&files).is_empty());
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
    assert!(exposed(&files).is_empty());
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

// A callback may run the function while the body of any module runs, also of one that the target asks for.
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
    assert_eq!(exposed(&files), ["a.cjs", "b.cjs"]);
    assert_eq!(half(&files), ["a.cjs", "b.cjs"]);
}

#[test]
fn what_an_import_call_names_is_exposed() {
    let files = [
        ("main.cjs", "import('./a.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "exports.x = 1;"),
    ];
    assert_eq!(exposed(&files), ["a.cjs", "b.cjs"]);
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
    assert_eq!(exposed(&files), ["pages/home.js"]);
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

// Whoever requires an ES module while its body runs gets an object without keys. The requests say where that happens, late ones too.
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
