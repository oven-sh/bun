use std::fmt::Write;

use bun_sema::bind::{CommonJsVariable, Decl, ScopeId};
use bun_sema::hir::{FnKind, ModuleId, Pat, PatId, PatKind, StmtKind};

use super::{
    creator_of, has_symbol_use, has_use, is_commonjs_slot, stored_in_loop, used_slots, walked,
    with_walk,
};
use crate::lower::scope::testing::{
    file_scope, first_statement, function_named, functions_of_kind, only_function, symbol_named,
    top_scope,
};
use crate::lower::scope::{BindingRef, ScopeSlot, WalkedFunctionId};

const EXPORTS: ScopeSlot = ScopeSlot::CommonJs(CommonJsVariable::Exports);
const MODULE: ScopeSlot = ScopeSlot::CommonJs(CommonJsVariable::Module);
const REQUIRE: ScopeSlot = ScopeSlot::CommonJs(CommonJsVariable::Require);
const FILENAME: ScopeSlot = ScopeSlot::CommonJs(CommonJsVariable::Filename);

// A store to one of the five names: the text of the file stays a function that has them as parameters.
const KEEPS_WRAPPER: &str = "__filename = '';";

fn is_block(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::Block(_))
}

fn is_for(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::For { .. })
}

fn is_for_of(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::ForOf { .. })
}

fn is_while(kind: &StmtKind) -> bool {
    matches!(kind, StmtKind::While { .. })
}

fn is_stored_in_loop(source: &str, is_loop: fn(&StmtKind) -> bool, name: &str) -> bool {
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let binding = BindingRef::Symbol(symbol_named(hir, bound, name));
        stored_in_loop(walk, first_statement(hir, is_loop)).contains(&binding)
    })
}

#[test]
fn stored_locals_of_loops() {
    let counter = "export function g() { for (let i = 0; i < 3; i++) { let b = i; } }";
    assert!(is_stored_in_loop(counter, is_for, "i"));
    assert!(!is_stored_in_loop(counter, is_for, "b"));

    let variable = "export function g() { for (let i = 0; i < 3; i++) { var x = 1; } return x; }";
    assert!(is_stored_in_loop(variable, is_for, "x"));

    let head_binding = "export function g(y: number[]) { for (let x of y) { x; } }";
    assert!(!is_stored_in_loop(head_binding, is_for_of, "x"));
}

#[test]
fn for_of_head_is_stored_in_loop() {
    let target = "export function g(y: number[]) { let x = 0; for (x of y) {} return x; }";
    assert!(is_stored_in_loop(target, is_for_of, "x"));

    let head_variable = "export function g(y: number[]) { for (var x of y) {} return x; }";
    assert!(is_stored_in_loop(head_variable, is_for_of, "x"));
}

#[test]
fn annex_b_function_stores_var() {
    let source = "function g() { var f; \
        for (var i = 0; i < 3; i++) { { function f() {} } } return f; }";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let function = function_named(hir, "f");
        let name = hir[function].name;
        let is_variable =
            |pattern: &Pat| matches!(pattern.kind, PatKind::Ident(found) if found == name);
        let variable = hir.pats.iter().position(is_variable);
        let variable = PatId(variable.expect("the source declares the variable") as u32);
        let variable_symbol = bound.declared_symbol(Decl::Var(variable));
        let block_symbol = bound.declared_symbol(Decl::Fn(function));
        assert_ne!(variable_symbol, block_symbol);
        let stored = stored_in_loop(walk, first_statement(hir, is_for));
        assert!(stored.contains(&BindingRef::Symbol(variable_symbol)));
        assert!(!stored.contains(&BindingRef::Symbol(block_symbol)));
    });
}

#[test]
fn store_reaches_every_enclosing_loop() {
    let source = "export function g() { let x = 0; \
        while (x < 1) { do { x = 1; } while (x < 2); } }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let binding = BindingRef::Symbol(symbol_named(hir, bound, "x"));
        assert_eq!(walk.loops.len(), 2);
        assert_eq!(walk.loops[0].statement, first_statement(hir, is_while));
        assert_eq!(walk.loops[0].parent, None);
        assert_eq!(walk.loops[1].parent, Some(0));
        assert!(
            walk.loops
                .iter()
                .all(|walked_loop| walked_loop.stored == [binding])
        );
    });
}

#[test]
fn store_in_nested_function_is_outside_loop() {
    let source = "export function g() { let x = 0; \
        while (g()) { const h = () => { x = 1; }; h(); } }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let symbol = symbol_named(hir, bound, "x");
        assert_eq!(walk.loops.len(), 1);
        assert!(walk.loops[0].stored.is_empty());
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert!(has_symbol_use(walk, arrow, symbol));
    });
}

#[test]
fn loop_names_its_function_and_boundary() {
    let source = "export function g(y: number[]) { \
        for (let i = 0; i < 3; i++) {} while (g(y)) {} }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let function = only_function(hir, FnKind::Decl);
        let counted = first_statement(hir, is_for);
        let [first, second] = &walk.loops[..] else {
            panic!("the source has two loops");
        };
        assert_eq!(first.statement, counted);
        assert_eq!(first.boundary, bound.own_scope(counted));
        assert_eq!(second.boundary, top_scope(bound, function));
        assert_eq!(first.function, walked(walk, function));
        assert_eq!(second.function, walked(walk, function));
    });
}

#[test]
fn try_is_no_loop() {
    let source = "export function g() { let x = 0; try { x = 1; } catch {} return x; }";
    with_walk(&[("main.ts", source)], |_, _, walk| {
        assert!(walk.loops.is_empty());
    });
}

#[test]
fn commonjs_variable_store_is_recorded() {
    let stored = "var i = 0; while (i < 2) { exports = { n: i }; i++; } exports.n;";
    with_walk(&[("main.cjs", stored)], |hir, bound, walk| {
        let scope = file_scope(hir, bound);
        assert_eq!(walk.stored_slots, [(scope, EXPORTS)]);
        let exports = BindingRef::Slot(scope, EXPORTS);
        assert!(walk.loops[0].stored.contains(&exports));
    });
    let read = format!("{KEEPS_WRAPPER} var i = 0; while (i < 2) {{ exports.n = i; i++; }}");
    with_walk(&[("main.cjs", read.as_str())], |hir, bound, walk| {
        let scope = file_scope(hir, bound);
        let exports = BindingRef::Slot(scope, EXPORTS);
        assert_eq!(walk.stored_slots, [(scope, FILENAME)]);
        assert!(!walk.loops[0].stored.contains(&exports));
        assert!(has_use(walk, WalkedFunctionId::MODULE_BODY, exports));
    });
}

#[test]
fn the_five_names_are_slots_only_where_the_wrapper_is_kept() {
    let plain = "exports.a = __filename; \
        module.exports.b = function () { return [require, module, exports, __dirname]; };";
    with_walk(&[("main.cjs", plain)], |_, _, walk| {
        assert!(!walk.has_wrapper_parameters);
        assert!(!used_slots(walk).into_iter().any(is_commonjs_slot));
    });
    let kept = format!("{KEEPS_WRAPPER} {plain}");
    with_walk(&[("main.cjs", kept.as_str())], |hir, bound, walk| {
        assert!(walk.has_wrapper_parameters);
        let function = walked(walk, only_function(hir, FnKind::Expr));
        for slot in [REQUIRE, MODULE, EXPORTS] {
            let binding = BindingRef::Slot(file_scope(hir, bound), slot);
            assert!(has_use(walk, function, binding));
        }
    });
}

#[test]
fn callee_of_a_bound_module_call_is_no_use() {
    let source = format!(
        "{KEEPS_WRAPPER} function lazy() {{ return require('./other.cjs'); }} \
         function resolved() {{ return require.resolve('./other.cjs'); }} \
         function through() {{ return module.require('./other.cjs'); }} \
         function value() {{ return [require, module]; }}"
    );
    with_walk(
        &[("main.cjs", source.as_str()), ("other.cjs", "")],
        |hir, bound, walk| {
            let scope = file_scope(hir, bound);
            let uses = |name: &str, slot: ScopeSlot| {
                let function = walked(walk, function_named(hir, name));
                has_use(walk, function, BindingRef::Slot(scope, slot))
            };
            assert!(!uses("lazy", REQUIRE));
            assert!(!uses("resolved", REQUIRE));
            assert!(!uses("through", MODULE));
            assert!(uses("value", REQUIRE));
            assert!(uses("value", MODULE));
        },
    );
}

#[test]
fn callee_of_a_require_that_may_be_replaced_is_a_use() {
    let source = "require = require; function lazy() { return require('./other.cjs'); }";
    with_walk(
        &[("main.cjs", source), ("other.cjs", "")],
        |hir, bound, walk| {
            let require = BindingRef::Slot(file_scope(hir, bound), REQUIRE);
            let function = walked(walk, only_function(hir, FnKind::Decl));
            assert!(has_use(walk, function, require));
        },
    );
}

#[test]
fn initialization_under_a_branch_is_conditional() {
    let source = "var plain = 1; { var block = 2; } if (plain) { var branch = 3; } \
        try { var tried = 4; } catch {} named: { var labeled = 5; } \
        switch (plain) { case 1: var chosen = 6; } while (plain) { var repeated = 7; } \
        if (plain) { (function () { var inner = 8; return inner; })(); }";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let is_conditional =
            |name: &str| walk.is_initialized_conditionally[symbol_named(hir, bound, name).idx()];
        for name in ["plain", "block", "inner"] {
            assert!(!is_conditional(name), "{name}");
        }
        for name in ["branch", "tried", "labeled", "chosen", "repeated"] {
            assert!(is_conditional(name), "{name}");
        }
    });
}

#[test]
fn callback_of_an_inner_module_is_a_body() {
    let source = "var __commonJS = (cb, mod) => () => \
        (mod || cb((mod = { exports: {} }).exports, mod), mod.exports); \
        var shared = 1; \
        var require_a = __commonJS((exports) => { \
            exports.x = shared; exports.f = function () { return exports.x; }; }); \
        export default require_a().f();";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let callback = walked(walk, functions_of_kind(hir, FnKind::Arrow)[2]);
        assert_eq!(creator_of(walk, callback), None);
        assert!(has_symbol_use(
            walk,
            callback,
            symbol_named(hir, bound, "shared")
        ));
        let holder = symbol_named(hir, bound, "require_a");
        assert!(!has_symbol_use(walk, WalkedFunctionId::MODULE_BODY, holder));
        let function = walked(walk, only_function(hir, FnKind::Expr));
        assert_eq!(creator_of(walk, function), Some(callback));
        assert!(!has_symbol_use(
            walk,
            function,
            symbol_named(hir, bound, "exports")
        ));
    });
}

#[test]
fn export_assignment_uses_module_variable() {
    let uses_module = |source: &str| {
        with_walk(&[("main.cts", source)], |hir, bound, walk| {
            let module = BindingRef::Slot(file_scope(hir, bound), MODULE);
            has_use(walk, WalkedFunctionId::MODULE_BODY, module)
        })
    };
    assert!(uses_module("__filename = ''; export = 1;"));
    assert!(!uses_module("__filename = ''; exports.a = 1;"));
    assert!(!uses_module("export = 1;"));
}

#[test]
fn redeclared_commonjs_variable_uses_no_slot() {
    let uses_module_slot = |source: &str| {
        with_walk(&[("main.cjs", source)], |_, _, walk| {
            used_slots(walk).contains(&MODULE)
        })
    };
    assert!(!uses_module_slot(
        "var module = module || {}; module.a = 1;"
    ));
    assert!(uses_module_slot(
        "var exports; var other = module || {}; other.a = 1;"
    ));
}

#[test]
fn es_module_has_no_commonjs_slots() {
    let source = "__filename = 'x'; export function f() { return __dirname; }";
    with_walk(&[("main.mjs", source)], |_, _, walk| {
        assert!(!used_slots(walk).into_iter().any(is_commonjs_slot));
        assert!(walk.stored_slots.is_empty());
    });
    with_walk(&[("main.cjs", "__filename = 'x';")], |_, _, walk| {
        assert!(used_slots(walk).into_iter().any(is_commonjs_slot));
        assert_eq!(walk.stored_slots.len(), 1);
    });
}

#[test]
fn import_equals_uses_entity_root() {
    let uses_namespace = |statements: &str| {
        let source = format!("namespace Box {{ export const inner = 1; }} {statements}");
        with_walk(&[("main.ts", source.as_str())], |_, bound, walk| {
            let namespace = bound.declared_symbol(Decl::Module(ModuleId(0)));
            has_symbol_use(walk, WalkedFunctionId::MODULE_BODY, namespace)
        })
    };
    assert!(uses_namespace(
        "import alias = Box.inner; console.log(alias); export {};"
    ));
    assert!(!uses_namespace("console.log(1); export {};"));
}

fn is_arrow_walked(imports: &str, test: &str, yes: &str, no: &str) -> bool {
    let source = format!(
        "{imports} function f() {{ let x = 1; if ({test}) {{ {yes} }} else {{ {no} }} return x }} \
         function g(h) {{ h() }} f();"
    );
    with_walk(&[("main.ts", source.as_str())], |hir, bound, walk| {
        let symbol = symbol_named(hir, bound, "x");
        let arrow = walk.function_of_fn[only_function(hir, FnKind::Arrow).idx()];
        let users = walk.uses.iter();
        let users = users.filter(|entry| entry.1 == BindingRef::Symbol(symbol));
        assert_eq!(users.count(), 1 + usize::from(arrow.is_some()));
        arrow.is_some_and(|arrow| has_symbol_use(walk, arrow, symbol))
    })
}

#[test]
fn dead_code_counts_for_nothing() {
    let imports = "import { feature } from \"bun:bundle\";";
    for (imports, test) in [(imports, "feature(\"OFF\")"), ("", "false")] {
        assert!(!is_arrow_walked(imports, test, "g(() => x)", ""), "{test}");
        assert!(is_arrow_walked(imports, test, "", "g(() => x)"), "{test}");
    }
}

#[test]
fn switch_scope_is_recorded() {
    let source = "export function g(a: number) { \
        switch (a) { case 1: { let c = a; return c; } default: let b = a; return b; } }";
    with_walk(&[("main.ts", source)], |hir, bound, walk| {
        let statement = first_statement(hir, |kind| matches!(kind, StmtKind::Switch { .. }));
        let block = bound.own_scope(first_statement(hir, is_block));
        assert!(walk.is_switch_scope[bound.own_scope(statement).idx()]);
        assert!(!walk.is_switch_scope[block.idx()]);
    });
}

#[test]
fn switch_binding_is_never_initialized() {
    let source = "export function g(v, f) { let y = 1; \
        switch (v) { case 0: let x = y; case 1: f(() => x); } }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let initialization =
            |name: &str| walk.symbol_initializations[symbol_named(hir, bound, name).idx()];
        assert_eq!(initialization("x"), None);
        assert!(initialization("y").is_some());
    });
}

#[test]
fn scopes_at_module_level() {
    let body = "{ let a = 1; a; } for (let i = 0; i < 2; i++) { let b = i; b; } \
        function f() { let c = 3; return c; }";
    let module = format!("export {{}}; {body}");
    for (file, source) in [("main.mjs", module.as_str()), ("main.cjs", body)] {
        with_walk(&[(file, source)], |hir, bound, walk| {
            let is_repeated = |scope: ScopeId| walk.is_repeated_scope[scope.idx()];
            let counted = first_statement(hir, is_for);
            let StmtKind::For { body, .. } = hir[counted].kind else {
                unreachable!();
            };
            assert!(!is_repeated(file_scope(hir, bound)), "{file}");
            assert!(
                !is_repeated(bound.own_scope(first_statement(hir, is_block))),
                "{file}"
            );
            assert!(is_repeated(bound.own_scope(counted)), "{file}");
            assert!(is_repeated(bound.own_scope(body)), "{file}");
            assert!(
                is_repeated(top_scope(bound, only_function(hir, FnKind::Decl))),
                "{file}"
            );
        });
    }
}

#[test]
fn with_object_is_used_by_dynamic_lookups() {
    let uses_of_arrow = |body: &str| {
        let source = format!("function f(o) {{ with (o) {{ {body} }} }}");
        with_walk(&[("main.cjs", source.as_str())], |hir, bound, walk| {
            let statement = first_statement(hir, |kind| matches!(kind, StmtKind::With { .. }));
            let object = BindingRef::Slot(bound.own_scope(statement), ScopeSlot::WithObject);
            let function = walked(walk, only_function(hir, FnKind::Decl));
            assert!(has_use(walk, function, object));
            let arrow = walked(walk, only_function(hir, FnKind::Arrow));
            has_use(walk, arrow, object)
        })
    };
    assert!(uses_of_arrow("return () => x;"));
    assert!(!uses_of_arrow("let y = 1; return () => y;"));
}

#[test]
fn uses_are_sorted_and_unique() {
    let source = "let a = 1; function f() { return a + a + b; } let b = a + f() + f();";
    with_walk(&[("main.ts", source)], |_, _, walk| {
        assert!(!walk.uses.is_empty());
        assert!(walk.uses.is_sorted_by(|earlier, later| earlier < later));
    });
}

#[test]
fn deep_tree_does_not_recurse() {
    let mut arms = String::new();
    for value in 1..5_000 {
        let _ = write!(arms, " else if (a === {value}) {{}}");
    }
    let source = format!(
        "export function f(a) {{ let x = 1; if (a === 0) {{}}{arms} else {{ g(() => x); }} }} \
         function g(h) {{ h(); }}"
    );
    with_walk(&[("main.mjs", source.as_str())], |hir, bound, walk| {
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert!(has_symbol_use(walk, arrow, symbol_named(hir, bound, "x")));
    });
}
