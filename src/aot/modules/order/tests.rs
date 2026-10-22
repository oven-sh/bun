use super::*;
use crate::modules::module_set::collect_modules;
use crate::modules::requests::scan_files;
use crate::modules::testing::{file_named, with_graph};

struct Ordered<'a, 'i, 's> {
    input: &'a BindInput<'i, 's>,
    order: EvaluationOrder,
    sites: PlannedSites,
}

fn with_order(files: &[(&str, &str)], check: impl FnOnce(&Ordered<'_, '_, '_>)) {
    with_graph(files, |_, input| {
        let scans = scan_files(input);
        let modules = collect_modules(input, &scans);
        let (order, sites) = compute_order(input, &scans, &modules);
        check(&Ordered {
            input,
            order,
            sites,
        });
    });
}

impl Ordered<'_, '_, '_> {
    fn module(&self, name: &str) -> ModuleRef {
        ModuleRef::File(file_named(self.input, name))
    }

    fn positions(&self, name: &str) -> Vec<SitePosition> {
        let sites = self.sites.of(file_named(self.input, name)).iter();
        sites.map(|site| site.position).collect()
    }

    fn half_modules<'n>(&self, names: &[&'n str]) -> Vec<&'n str> {
        let names = names.iter().copied();
        names.filter(|name| self.order.half(self.module(name))).collect()
    }

    fn exposed_modules<'n>(&self, names: &[&'n str]) -> Vec<&'n str> {
        let names = names.iter().copied();
        names.filter(|name| self.order.exposed(self.module(name))).collect()
    }
}

const LEAF: (&str, &str) = ("leaf.cjs", "exports.x = 1;");

fn position_of(source: &str) -> SitePosition {
    let mut found = None;
    with_order(&[("main.cjs", source), LEAF], |ordered| {
        let positions = ordered.positions("main.cjs");
        assert_eq!(positions.len(), 1, "{source}");
        found = Some(positions[0]);
    });
    found.expect("the check ran")
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
    for source in sources {
        assert_eq!(position_of(source), SitePosition::InOrder, "{source}");
    }
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
    for source in sources {
        assert_eq!(position_of(source), SitePosition::Sometimes, "{source}");
    }
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
    for source in sources {
        assert_eq!(position_of(source), SitePosition::Late, "{source}");
    }
}

#[test]
fn no_site_of_a_body_that_awaits_is_in_order() {
    let files = [("main.mjs", "require('./leaf.cjs'); await 0;"), LEAF];
    with_order(&files, |ordered| {
        assert_eq!(ordered.positions("main.mjs"), [SitePosition::Sometimes]);
    });
}

const NAMES: [&str; 4] = ["main.cjs", "a.cjs", "b.cjs", "c.cjs"];

#[test]
fn a_chain_of_requires_is_seen_whole() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "require('./c.cjs');"),
        ("c.cjs", "exports.x = 1;"),
    ];
    with_order(&files, |ordered| {
        assert!(ordered.half_modules(&NAMES).is_empty());
        assert!(ordered.exposed_modules(&NAMES).is_empty());
    });
}

#[test]
fn the_modules_of_a_cycle_are_seen_half_done() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        ("a.cjs", "exports.first = 1; require('./b.cjs'); exports.second = 2;"),
        ("b.cjs", "exports.seen = require('./a.cjs').second; require('./c.cjs');"),
        ("c.cjs", "exports.x = 1;"),
    ];
    with_order(&files, |ordered| {
        assert_eq!(ordered.half_modules(&NAMES), ["a.cjs", "b.cjs"]);
        assert!(ordered.exposed_modules(&NAMES).is_empty());
    });
}

#[test]
fn a_module_that_requires_itself_is_seen_half_done() {
    let files = [("main.cjs", "require('./a.cjs');"), ("a.cjs", "require('./a.cjs');")];
    with_order(&files, |ordered| {
        assert_eq!(ordered.half_modules(&["main.cjs", "a.cjs"]), ["a.cjs"]);
    });
}

#[test]
fn a_cycle_through_a_branch_counts() {
    let files = [
        ("main.cjs", "require('./a.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "if (exports.y) require('./a.cjs');"),
    ];
    with_order(&files, |ordered| {
        assert_eq!(ordered.half_modules(&NAMES[..3]), ["a.cjs", "b.cjs"]);
    });
}

#[test]
fn a_cycle_of_imports_and_requires_counts() {
    let files = [
        ("main.mjs", "import './a.mjs';"),
        ("a.mjs", "import './b.cjs'; export const x = 1;"),
        ("b.cjs", "exports.x = require('./a.mjs').x;"),
    ];
    with_order(&files, |ordered| {
        let names = ["main.mjs", "a.mjs", "b.cjs"];
        assert_eq!(ordered.half_modules(&names), ["a.mjs", "b.cjs"]);
    });
}

// A callback may run the function while the body of any module runs, also of one that the target asks for.
#[test]
fn what_a_late_site_may_run_is_exposed() {
    let files = [
        ("main.cjs", "exports.f = () => require('./a.cjs'); require('./c.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "exports.x = 1;"),
        ("c.cjs", "exports.x = 1;"),
    ];
    with_order(&files, |ordered| {
        assert_eq!(ordered.exposed_modules(&NAMES), ["a.cjs", "b.cjs"]);
        assert_eq!(ordered.half_modules(&NAMES), ["a.cjs", "b.cjs"]);
    });
}

#[test]
fn what_an_import_call_names_is_exposed() {
    let files = [
        ("main.cjs", "import('./a.cjs');"),
        ("a.cjs", "require('./b.cjs');"),
        ("b.cjs", "exports.x = 1;"),
    ];
    with_order(&files, |ordered| {
        assert_eq!(ordered.exposed_modules(&NAMES[..3]), ["a.cjs", "b.cjs"]);
    });
}

#[test]
fn what_a_computed_require_may_name_is_exposed() {
    let files = [
        ("main.cjs", "module.exports = (name) => require(`./pages/${name}.js`);"),
        ("pages/home.js", "exports.x = 1;"),
    ];
    with_order(&files, |ordered| {
        assert_eq!(ordered.exposed_modules(&["main.cjs", "pages/home.js"]), ["pages/home.js"]);
    });
}

#[test]
fn a_site_in_a_branch_exposes_nothing() {
    let files = [("main.cjs", "if (exports.y) require('./a.cjs');"), ("a.cjs", "exports.x = 1;")];
    with_order(&files, |ordered| {
        assert!(ordered.half_modules(&NAMES[..2]).is_empty());
    });
}

fn evaluates(files: &[(&str, &str)]) -> Vec<bool> {
    let mut found = Vec::new();
    with_order(files, |ordered| {
        let sites = ordered.sites.of(file_named(ordered.input, files[0].0)).iter();
        found = sites.map(|site| site.evaluates).collect();
    });
    found
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
    let plain = [("main.cjs", "require('./a.mjs'); require('./leaf.cjs');"), ("a.mjs", ""), LEAF];
    assert_eq!(evaluates(&plain), [true, true]);
}

// Whoever requires an ES module while its body runs gets an object without keys. The requests say where that happens, late ones too.
#[test]
fn the_loader_keeps_an_es_module_that_may_be_seen_half_done() {
    let cycle = [
        ("first.mjs", "const second = require('./second.mjs'); export const name = 'first';"),
        ("second.mjs", "const first = require('./first.mjs'); console.log(first.name);"),
    ];
    assert_eq!(evaluates(&cycle), [false]);
    let late_cycle = [
        ("main.cjs", "exports.f = () => require('./a.mjs');"),
        ("a.mjs", "import './main.cjs'; export {};"),
    ];
    assert_eq!(evaluates(&late_cycle), [false]);
    let lazy = [("main.cjs", "exports.f = () => require('./a.mjs');"), ("a.mjs", "export {};")];
    assert_eq!(evaluates(&lazy), [true]);
    let lazy_commonjs = [("main.cjs", "exports.f = () => require('./leaf.cjs');"), LEAF];
    assert_eq!(evaluates(&lazy_commonjs), [true]);
}
