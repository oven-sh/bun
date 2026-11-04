use std::fmt::Write;

use bun_sema::hir::{FnKind, StmtKind};
use bun_sema::program::FileId;

use super::{COPIED, analyze_files, analyze_source, first_field, is_field, storage_in};
use crate::ir::FunctionKey;
use crate::lower::captures::{Capture, max_captures};
use crate::lower::scope::testing::source_key;
use crate::lower::scope::{Placement, ScopeSlot, Storage};

const CLASSIC_JSX: &str = r#"{"compilerOptions":{"jsx":"react","jsxFactory":"probe"}}"#;

#[test]
fn local_unless_mentioned_elsewhere() {
    let source = "export function f() { let a = 1; return a; }";
    analyze_source("main.mjs", source, |probe| {
        let top = probe.top_of("f");
        let expected = Placement {
            storage: Storage::Local,
            has_local: true,
            is_immutable: true,
            is_shared: false,
        };
        assert_eq!(probe.placement_of("a"), expected);
        assert_eq!(probe.bindings(top), [probe.binding("a")]);
        assert!(!probe.has_environment(top));
    });
}

#[test]
fn immutable_binding_is_copied() {
    let source = "export function f() { const a = 1; return () => a; }";
    analyze_source("main.mjs", source, |probe| {
        assert_eq!(probe.placement_of("a"), COPIED);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("a")]);
        assert!(!probe.has_environment(probe.top_of("f")));
    });
}

#[test]
fn parameter_is_copied() {
    let source = "export function f(p) { return () => p; }";
    analyze_source("main.mjs", source, |probe| {
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("p")]);
        assert_eq!(probe.placement_of("p").storage, Storage::Local);
    });
}

fn assert_entry_slot_is_copied(expression: &str, slot: ScopeSlot) {
    let source = format!("export function f() {{ return () => {expression}; }}");
    analyze_source("main.mjs", &source, |probe| {
        let binding = probe.slot(probe.function("f"), slot);
        assert_eq!(
            probe.captures(probe.arrow()),
            [Capture::Value(binding)],
            "{expression}"
        );
        let placement = probe.placement(binding);
        assert_eq!(placement.storage, Storage::Local, "{expression}");
        assert!(
            placement.is_shared && placement.is_immutable,
            "{expression}"
        );
    });
}

#[test]
fn this_is_copied() {
    assert_entry_slot_is_copied("this", ScopeSlot::This);
}

#[test]
fn new_target_is_copied() {
    assert_entry_slot_is_copied("new.target", ScopeSlot::NewTarget);
}

#[test]
fn arguments_object_is_copied() {
    assert_entry_slot_is_copied("arguments", ScopeSlot::ArgumentsBinding);
}

#[test]
fn unused_slot_has_no_placement() {
    analyze_source("main.mjs", "export function f() { return 1; }", |probe| {
        let function = probe.function("f");
        for slot in [ScopeSlot::This, ScopeSlot::NewTarget, ScopeSlot::Callee] {
            assert_eq!(probe.analysis.placement(probe.slot(function, slot)), None);
        }
        assert!(probe.bindings(probe.top_scope(function)).is_empty());
    });
}

#[test]
fn stored_binding_has_a_field() {
    let source = "export function f() { let a = 1; const g = () => a; a = 2; return g; }";
    analyze_source("main.mjs", source, |probe| {
        let top = probe.top_of("f");
        let expected = first_field(top, false);
        assert_eq!(probe.placement_of("a"), expected);
        assert_eq!(probe.environment_fields(top), [probe.binding("a")]);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Environment(top)]);
    });
}

#[test]
fn earlier_closure_takes_the_environment() {
    let source = "export function f() { \
        const g = () => a; const a = 1; const h = () => a; return [g, h]; }";
    analyze_source("main.mjs", source, |probe| {
        let top = probe.top_of("f");
        let [earlier, later] = probe.functions(FnKind::Arrow)[..] else {
            panic!("the source has two arrow functions");
        };
        assert_eq!(probe.captures(earlier), [Capture::Environment(top)]);
        assert_eq!(probe.captures(later), [probe.copy_of("a")]);
        let placement = probe.placement_of("a");
        assert!(is_field(placement.storage));
        assert!(placement.has_local);
    });
}

#[test]
fn hoisted_function_takes_the_environment() {
    let source = "export function f() { \
        const a = 1; function g() { return a; } const h = () => a; return [g, h]; }";
    analyze_source("main.mjs", source, |probe| {
        let top = probe.top_of("f");
        assert_eq!(probe.captures_of("g"), [Capture::Environment(top)]);
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("a")]);
        let placement = probe.placement_of("a");
        assert!(is_field(placement.storage));
        assert!(placement.has_local);
    });
}

#[test]
fn closure_in_hoisted_function_takes_the_environment() {
    let source = "export function f() { const a = 1; function g() { return () => a; } return g; }";
    analyze_source("main.mjs", source, |probe| {
        let environment = [Capture::Environment(probe.top_of("f"))];
        assert_eq!(probe.captures(probe.arrow()), environment);
        assert_eq!(probe.captures_of("g"), environment);
    });
}

#[test]
fn hoisted_function_copies_parameter() {
    let source = "export function f(p) { function g() { return p; } return g; }";
    analyze_source("main.mjs", source, |probe| {
        assert_eq!(probe.captures_of("g"), [probe.copy_of("p")]);
        assert_eq!(probe.placement_of("p").storage, Storage::Local);
    });
}

#[test]
fn hoisted_block_function_does_not_copy_var() {
    let source = "export function f() { { h(); var a = 1; function h() { return a; } } }";
    analyze_source("main.mjs", source, |probe| {
        let top = probe.top_of("f");
        assert_eq!(probe.captures_of("h"), [Capture::Environment(top)]);
        assert_eq!(probe.environment_fields(top), [probe.binding("a")]);
    });
}

#[test]
fn hoisted_function_copies_from_outer_function() {
    let source = "export function f() { const a = 1; \
        return function g() { function h() { return a; } return h; }; }";
    analyze_source("main.mjs", source, |probe| {
        let copy = [probe.copy_of("a")];
        assert_eq!(probe.captures_of("g"), copy);
        assert_eq!(probe.captures_of("h"), copy);
        assert_eq!(probe.placement_of("a").storage, Storage::Local);
    });
}

#[test]
fn hoisted_function_symbol_is_copied_by_later_closure() {
    let later = "export function f() { function g() {} return () => g; }";
    analyze_source("main.mjs", later, |probe| {
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("g")]);
        assert_eq!(probe.placement_of("g").storage, Storage::Local);
    });
    let sibling = "export function f() { function g() { return h; } function h() {} return g; }";
    analyze_source("main.mjs", sibling, |probe| {
        let top = probe.top_of("f");
        assert_eq!(probe.captures_of("g"), [Capture::Environment(top)]);
        assert_eq!(probe.environment_fields(top), [probe.binding("h")]);
        assert!(probe.placement_of("h").has_local);
    });
}

#[test]
fn loop_binding_is_copied() {
    let source = "export function f(xs, cb) { for (const x of xs) cb(() => x); }";
    analyze_source("main.mjs", source, |probe| {
        let statement = probe.first_statement(|kind| matches!(kind, StmtKind::ForOf { .. }));
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("x")]);
        assert!(!probe.has_environment(probe.bound.own_scope(statement)));
    });
}

#[test]
fn switch_binding_has_a_field() {
    let source = "export function g(v, f) { \
        switch (v) { case 0: let x = 1; case 1: f(() => x); } }";
    analyze_source("main.mjs", source, |probe| {
        let statement = probe.first_statement(|kind| matches!(kind, StmtKind::Switch { .. }));
        let scope = probe.bound.own_scope(statement);
        assert!(probe.is_switch_scope(scope));
        assert!(!probe.is_switch_scope(probe.top_of("g")));
        let field = Storage::Field { scope, field: 0 };
        assert_eq!(probe.placement_of("x").storage, field);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Environment(scope)]);
    });
}

#[test]
fn intermediate_function_passes_on() {
    let source = "export function f() { const a = 1; return () => () => () => a; }";
    analyze_source("main.mjs", source, |probe| {
        let arrows = probe.functions(FnKind::Arrow);
        assert_eq!(arrows.len(), 3);
        for arrow in arrows {
            assert_eq!(probe.captures(arrow), [probe.copy_of("a")]);
        }
        assert!(probe.captures_of("f").is_empty());
    });
}

#[test]
fn environments_precede_values_outermost_first() {
    let source = "export function f() { let m = 1; const c = 2; \
        { let n = 3; const g = () => [n, c, m]; m = 4; n = 5; return g; } }";
    analyze_source("main.mjs", source, |probe| {
        let top = probe.top_of("f");
        let block = probe.first_statement(|kind| matches!(kind, StmtKind::Block(_)));
        let expected = [
            Capture::Environment(top),
            Capture::Environment(probe.bound.own_scope(block)),
            probe.copy_of("c"),
        ];
        assert_eq!(probe.captures(probe.arrow()), expected);
    });
}

#[test]
fn no_capture_of_own_binding() {
    let source = "export function f() { let a = 1; const g = () => a; a = 2; return g; }";
    analyze_source("main.mjs", source, |probe| {
        assert!(is_field(probe.placement_of("a").storage));
        assert!(probe.captures_of("f").is_empty());
    });
}

#[test]
fn module_body_and_other_files_capture_nothing() {
    let source = "export function f() { const a = 1; return () => a; }";
    analyze_source("main.mjs", source, |probe| {
        let file = probe.analysis.file;
        let arrow = probe.arrow();
        let elsewhere = source_key(FileId(file.0 + 1), arrow);
        assert!(!probe.analysis.captures(source_key(file, arrow)).is_empty());
        assert!(probe.analysis.captures(elsewhere).is_empty());
        let body = FunctionKey::ModuleBody(file);
        assert!(probe.analysis.captures(body).is_empty());
    });
}

fn create_constants_source(count: usize) -> String {
    let (mut declarations, mut mentions) = (String::new(), String::new());
    for index in 0..count {
        let _ = write!(declarations, " const v{index} = {index};");
        let _ = write!(mentions, "v{index}, ");
    }
    format!(
        "export function f() {{{declarations} const all = () => [{mentions}]; \
         const one = () => v0; return [all, one]; }}"
    )
}

#[test]
fn capture_limit() {
    let count = max_captures() + 1;
    analyze_source("main.mjs", &create_constants_source(count), |probe| {
        let top = probe.top_of("f");
        let [all, one] = probe.functions(FnKind::Arrow)[..] else {
            panic!("the source has two arrow functions");
        };
        assert!(probe.has_too_many_captures(probe.key(all)));
        assert_eq!(probe.captures(all), [Capture::Environment(top)]);
        let fields = probe.environment_fields(top);
        assert_eq!(fields.len(), count);
        assert!(fields.iter().all(|&field| probe.placement(field).has_local));
        assert!(!probe.has_too_many_captures(probe.key(one)));
        assert_eq!(probe.captures(one), [probe.copy_of("v0")]);
    });
}

#[test]
fn capture_list_at_the_limit_stays() {
    let count = max_captures();
    analyze_source("main.mjs", &create_constants_source(count), |probe| {
        let all = probe.functions(FnKind::Arrow)[0];
        assert!(!probe.has_too_many_captures(probe.key(all)));
        assert_eq!(probe.captures(all).len(), count);
        assert!(!probe.has_environment(probe.top_of("f")));
    });
}

fn probe_storage(file: &str, source: &str) -> Storage {
    let files = [(file, source), ("tsconfig.json", CLASSIC_JSX)];
    analyze_files(&files, |probe| probe.placement_of("probe").storage)
}

#[test]
fn later_closures_copy() {
    let sources = [
        "export function f(it) { const [probe] = it; }",
        "export function f(it) { const [probe] = it; return () => probe; }",
        "export function f(it) { const [probe] = it, g = () => probe; return g; }",
        "export function f(it) { const [probe] = it; return class { m() { return probe; } }; }",
        "export function f(it) { var [probe] = it; return () => probe; }",
        "export function f(it) { for (let [probe] = it; ; ) { return () => probe; } }",
        "export function f(it, gs) { for (const [probe] of it) { gs.push(() => probe); } }",
        "export function f() { try { f(); } catch ([probe]) { return () => probe; } }",
    ];
    for source in sources {
        assert_eq!(
            probe_storage("main.mjs", source),
            Storage::Local,
            "{source}"
        );
    }
}

#[test]
fn earlier_closures_need_a_field() {
    let sources = [
        "export function f(it) { const g = () => probe; const [probe] = it; return g; }",
        "export function f(it) { class C { m() { return probe; } } \
            const [probe] = it; return C; }",
        "export function f(it) { { function g() { return probe; } g; } const [probe] = it; }",
        "export function f(it) { const [probe, g = () => probe] = it; return g; }",
        "export function f(make) { const [probe] = make(() => probe); return probe; }",
        "export function f(x, it) { let g; switch (x) { default: const [probe] = it; return g; \
            case (g = () => probe, 1): return g; } }",
    ];
    for source in sources {
        assert!(is_field(probe_storage("main.mjs", source)), "{source}");
    }
}

#[test]
fn hoisted_functions_need_a_field() {
    let sources = [
        "export function f(it) { const [probe] = it; function g() { return probe; } return g; }",
        "export function f(it) { const [probe] = it; \
            function g() { return () => probe; } return g; }",
        "export function f(it) { const [probe] = it; \
            { function g() { return probe; } return g; } }",
        "export function f(x, it) { switch (x) { case 0: const [probe] = it; \
            case 1: function g() { return probe; } return g; } }",
    ];
    for source in sources {
        assert!(is_field(probe_storage("main.mjs", source)), "{source}");
    }
}

#[test]
fn parameters_precede_hoisted_functions() {
    let bound_first = [
        "export function f([probe]) { function g() { return probe; } return g; }",
        "export function f([probe], g = () => probe) { return g; }",
    ];
    for source in bound_first {
        assert_eq!(
            probe_storage("main.mjs", source),
            Storage::Local,
            "{source}"
        );
    }
    let captured_first = "export function f(g = () => probe, [probe] = []) { return g; }";
    assert!(is_field(probe_storage("main.mjs", captured_first)));
}

#[test]
fn jsx_factory_use_counts_as_capture() {
    let later = "export function f(it) { const [probe] = it; return () => <a />; }";
    let files = [("main.jsx", later), ("tsconfig.json", CLASSIC_JSX)];
    analyze_files(&files, |probe| {
        assert_eq!(probe.captures(probe.arrow()), [probe.copy_of("probe")]);
    });
    let hoisted = "export function f(it) { const [probe] = it; \
        function g() { return <a />; } return g; }";
    assert!(is_field(probe_storage("main.jsx", hoisted)));
}

#[test]
fn dead_closure_shares_nothing() {
    let dead = "export function f(g) { let x = 1; if (false) { g(() => x); } return x; }";
    analyze_source("main.mjs", dead, |probe| {
        assert!(!probe.placement_of("x").is_shared);
        assert!(probe.captures(probe.arrow()).is_empty());
    });
    let live = "export function f(g) { let x = 1; if (true) { g(() => x); } return x; }";
    analyze_source("main.mjs", live, |probe| {
        assert!(probe.placement_of("x").is_shared)
    });
}

#[test]
fn dead_store_leaves_binding_immutable() {
    let dead = "export function f() { let x = 1; if (false) { x = 2; } return () => x; }";
    assert_eq!(storage_in("main.mjs", dead, "x"), Storage::Local);
    let live =
        "export function f(c) { let x = 1; const read = () => x; if (c) { x = 2; } return read; }";
    assert!(is_field(storage_in("main.mjs", live, "x")));
}
