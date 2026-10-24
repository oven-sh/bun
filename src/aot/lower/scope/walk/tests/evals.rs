use bun_sema::bind::{BindingKind, Bound, ScopeId};
use bun_sema::hir::{ClassId, FnKind, MemberId, StmtKind};

use super::{
    has_use, initialized_at, is_commonjs_slot, slots_used_by, stored_in_loop, used_slots, walked,
    with_walk,
};
use crate::ir::ClassSlot;
use crate::lower::commonjs::WRAPPER_PARAMETERS;
use crate::lower::scope::testing::{
    file_scope, first_statement, only_function, symbol_named, top_scope,
};
use crate::lower::scope::{BindingRef, ScopeSlot};

fn stored_slots(file: &str, source: &str) -> Vec<ScopeSlot> {
    with_walk(&[(file, source)], |_, _, walk| {
        walk.stored_slots.iter().map(|&(_, slot)| slot).collect()
    })
}

fn variable_kinds(
    bound: &Bound<'_>,
    bindings: impl Iterator<Item = BindingRef>,
) -> Vec<BindingKind> {
    let kinds = bindings.filter_map(|binding| match binding {
        BindingRef::Symbol(symbol) => Some(bound.binding_kind(symbol)),
        BindingRef::Slot(..) => None,
    });
    let mut kinds: Vec<BindingKind> = kinds
        .filter(|&kind| kind != BindingKind::Function)
        .collect();
    kinds.sort();
    kinds
}

fn variable_kinds_seen_by_eval(source: &str) -> Vec<BindingKind> {
    with_walk(&[("main.cjs", source)], |_, bound, walk| {
        variable_kinds(
            bound,
            walk.eval_uses.iter().map(|eval_use| eval_use.binding),
        )
    })
}

#[test]
fn eval_use_has_time() {
    let source = "export function g(s) { const a = 1; eval(s); const b = 2; return b; }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let function = walked(walk, only_function(hir, FnKind::Decl));
        let (first, second) = (symbol_named(hir, bound, "a"), symbol_named(hir, bound, "b"));
        for symbol in [first, second] {
            let binding = BindingRef::Symbol(symbol);
            let mut eval_uses = walk.eval_uses.iter();
            let eval_use = eval_uses.find(|eval_use| eval_use.binding == binding);
            let eval_use = eval_use.expect("the evaluated text sees the binding");
            assert_eq!(eval_use.function, function);
            assert!(initialized_at(walk, first) < eval_use.time);
            assert!(eval_use.time < initialized_at(walk, second));
            assert!(has_use(walk, function, binding));
        }
    });
}

#[test]
fn catch_parameter_does_not_hide_the_variable_from_eval() {
    use BindingKind::{Let, Parameter, SimpleCatchParameter, Var};
    let variable =
        "function f() { var e = 1; try { throw 5; } catch (e) { eval(s); } return typeof e; }";
    assert_eq!(
        variable_kinds_seen_by_eval(variable),
        [Var, SimpleCatchParameter]
    );
    let parameter = "function f(e) { try { throw 5; } catch (e) { eval(s); } return typeof e; }";
    assert_eq!(
        variable_kinds_seen_by_eval(parameter),
        [SimpleCatchParameter, Parameter]
    );
    let nested = "function f() { var e; try {} catch (e) { try {} catch (e) { eval(s); } } }";
    let expected = [Var, SimpleCatchParameter, SimpleCatchParameter];
    assert_eq!(variable_kinds_seen_by_eval(nested), expected);
    let lexical = "function f() { var e; { let e; try {} catch (e) { eval(s); } } }";
    assert_eq!(
        variable_kinds_seen_by_eval(lexical),
        [Let, SimpleCatchParameter]
    );
    let pattern = "function f() { var e; try {} catch ({ e }) { eval(s); } }";
    assert_eq!(variable_kinds_seen_by_eval(pattern), [Let]);
    let strict = "'use strict'; function f() { var e; try {} catch (e) { eval(s); } }";
    assert_eq!(variable_kinds_seen_by_eval(strict), [SimpleCatchParameter]);
}

#[test]
fn eval_in_loop_stores_the_variable_behind_the_catch_parameter() {
    let source = "function f() { var e; for (;;) { try {} catch (e) { eval(s); } } }";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let statement = first_statement(hir, |kind| matches!(kind, StmtKind::For { .. }));
        let stored = stored_in_loop(walk, statement).iter().copied();
        let expected = [BindingKind::Var, BindingKind::SimpleCatchParameter];
        assert_eq!(variable_kinds(bound, stored), expected);
    });
}

#[test]
fn indirect_eval_uses_nothing() {
    let source = "export function g(s) { const a = 1; return (0, eval)(s); }";
    with_walk(&[("main.mjs", source)], |_, _, walk| {
        assert!(walk.eval_uses.is_empty());
        assert!(walk.eval_variable_scopes.is_empty());
    });
}

#[test]
fn direct_eval_in_constructor_stores_this() {
    let stores_this = |member: &str| {
        let source = format!("class A {{}} class B extends A {{ {member} }} new B();");
        stored_slots("main.cjs", &source).contains(&ScopeSlot::This)
    };
    assert!(stores_this("constructor(s) { eval(s); }"));
    assert!(!stores_this("m(s) { eval(s); }"));
    assert!(!stores_this("constructor(s) { if (false) eval(s); }"));
}

#[test]
fn direct_eval_in_constructor_references_constructor() {
    let source = "export class B extends Object { constructor(s) { eval(s); } }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let constructor = only_function(hir, FnKind::Constructor);
        let callee = BindingRef::Slot(top_scope(bound, constructor), ScopeSlot::Callee);
        assert_eq!(
            walk.function_references,
            [(walked(walk, constructor), constructor)]
        );
        assert!(has_use(walk, walked(walk, constructor), callee));
    });
}

#[test]
fn direct_eval_uses_home_object_of_method_only() {
    let uses_home_object = |source: &str| {
        with_walk(&[("main.cjs", source)], |_, _, walk| {
            used_slots(walk).contains(&ScopeSlot::HomeObject)
        })
    };
    assert!(uses_home_object(
        "module.exports = { m(s) { return eval(s); } };"
    ));
    assert!(!uses_home_object(
        "module.exports = function (s) { return eval(s); };"
    ));
    assert!(!uses_home_object(
        "module.exports = function (s) { return () => eval(s); };"
    ));
}

#[test]
fn direct_eval_uses_commonjs_variables() {
    let source = "function load(s) { return eval(s); }";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let function = walked(walk, only_function(hir, FnKind::Decl));
        for variable in WRAPPER_PARAMETERS {
            let binding = BindingRef::Slot(file_scope(hir, bound), ScopeSlot::CommonJs(variable));
            assert!(has_use(walk, function, binding), "{variable:?}");
            let mut eval_uses = walk.eval_uses.iter();
            assert!(
                eval_uses.any(|eval_use| eval_use.binding == binding),
                "{variable:?}"
            );
        }
    });
    let uses_commonjs_variable = |file: &str, source: &str| {
        with_walk(&[(file, source)], |_, _, walk| {
            used_slots(walk).into_iter().any(is_commonjs_slot)
        })
    };
    assert!(!uses_commonjs_variable(
        "main.mjs",
        "export function load(s) { return eval(s); }"
    ));
    assert!(!uses_commonjs_variable(
        "main.cjs",
        "function load(s) { if (false) eval(s); }"
    ));
}

#[test]
fn direct_eval_skips_redeclared_commonjs_variable() {
    let source = "var exports = {}; function load(s) { return eval(s); }";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let function = walked(walk, only_function(hir, FnKind::Decl));
        let slots = slots_used_by(walk, function);
        let commonjs_slots = slots.iter().filter(|slot| is_commonjs_slot(slot.1));
        assert_eq!(commonjs_slots.count(), WRAPPER_PARAMETERS.len() - 1);
        let redeclared = BindingRef::Symbol(symbol_named(hir, bound, "exports"));
        assert!(has_use(walk, function, redeclared));
    });
}

#[test]
fn direct_eval_stores_assignable_slots() {
    let sloppy = stored_slots("main.cjs", "function f(s) { return eval(s); }");
    assert!(sloppy.contains(&ScopeSlot::ArgumentsBinding));
    for variable in WRAPPER_PARAMETERS {
        assert!(
            sloppy.contains(&ScopeSlot::CommonJs(variable)),
            "{variable:?}"
        );
    }
    let strict = stored_slots("main.mjs", "export function f(s) { return eval(s); }");
    assert!(strict.is_empty());
    let constructor = "export class C { constructor(s) { eval(s); } }";
    assert_eq!(stored_slots("main.mjs", constructor), [ScopeSlot::This]);
    let dead = stored_slots("main.cjs", "function f(s) { if (false) eval(s); }");
    assert!(dead.is_empty());
}

#[test]
fn direct_eval_uses_arguments_of_enclosing_function() {
    let source = "export function f(s) { return () => eval(s); }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let scope = top_scope(bound, only_function(hir, FnKind::Decl));
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        let expected = [
            (scope, ScopeSlot::This),
            (scope, ScopeSlot::NewTarget),
            (scope, ScopeSlot::Arguments),
            (scope, ScopeSlot::ArgumentsBinding),
        ];
        assert_eq!(slots_used_by(walk, arrow), expected);
    });
}

#[test]
fn direct_eval_uses_arguments_of_commonjs_body() {
    let uses_arguments = |file: &str, source: &str| {
        with_walk(&[(file, source)], |hir, bound, walk| {
            let scope = file_scope(hir, bound);
            let slots = [ScopeSlot::Arguments, ScopeSlot::ArgumentsBinding];
            let is_seen = |slot: ScopeSlot| {
                let binding = BindingRef::Slot(scope, slot);
                walk.eval_uses
                    .iter()
                    .any(|eval_use| eval_use.binding == binding)
            };
            slots.map(is_seen)
        })
    };
    let rows = [
        ("main.cjs", "var s = ''; eval(s);", true),
        ("main.cjs", "module.exports = (s) => eval(s);", true),
        ("main.cjs", "function f(s) { eval(s); }", false),
        ("main.mjs", "var s = ''; eval(s); export {};", false),
    ];
    for (file, source, is_seen) in rows {
        assert_eq!(uses_arguments(file, source), [is_seen; 2], "{source}");
    }
    let sloppy = stored_slots("main.cjs", "var s = ''; eval(s);");
    assert!(sloppy.contains(&ScopeSlot::ArgumentsBinding));
    let strict = stored_slots("main.cjs", "'use strict'; var s = ''; eval(s);");
    assert!(!strict.contains(&ScopeSlot::ArgumentsBinding));
}

#[test]
fn direct_eval_uses_slots_of_enclosing_classes() {
    let source = "export class C { #p = 1; static #s = 2; #m() {} r(s) { return eval(s); } }";
    with_walk(&[("main.mjs", source)], |hir, bound, walk| {
        let members: Vec<MemberId> = hir[ClassId(0)].members.iter().collect();
        let [_, static_field, private_method, reader] = members[..] else {
            panic!("the class has four members");
        };
        let class_scope = bound.class_scope[ClassId(0).idx()];
        let reader = hir[reader].func;
        let scope = top_scope(bound, reader);
        let expected = [
            (class_scope, ScopeSlot::Class(ClassSlot::ClassObject)),
            (class_scope, ScopeSlot::Class(ClassSlot::ClassToken)),
            (
                class_scope,
                ScopeSlot::Class(ClassSlot::StaticField(static_field)),
            ),
            (
                class_scope,
                ScopeSlot::Class(ClassSlot::PrivateMethod(private_method)),
            ),
            (scope, ScopeSlot::This),
            (scope, ScopeSlot::Arguments),
            (scope, ScopeSlot::ArgumentsBinding),
        ];
        assert_eq!(slots_used_by(walk, walked(walk, reader)), expected);
    });
}

fn eval_variable_scopes(source: &str) -> (Vec<ScopeId>, ScopeId) {
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let scope = top_scope(bound, only_function(hir, FnKind::Decl));
        (walk.eval_variable_scopes.clone(), scope)
    })
}

#[test]
fn sloppy_eval_declares_in_function() {
    let (scopes, function_scope) = eval_variable_scopes("function f(s) { eval(s); }");
    assert_eq!(scopes, [function_scope]);
    let (scopes, function_scope) = eval_variable_scopes("function f(s) { { eval(s); } }");
    assert_eq!(scopes, [function_scope]);
    let with_own_directive = "function f(s) { 'use strict'; eval(s); }";
    let (scopes, function_scope) = eval_variable_scopes(with_own_directive);
    assert_eq!(scopes, [function_scope]);
    let (scopes, _) = eval_variable_scopes("'use strict'; function f(s) { eval(s); }");
    assert!(scopes.is_empty());
    let (scopes, _) = eval_variable_scopes("function f(s) { if (false) { eval(s); } }");
    assert!(scopes.is_empty());
}

#[test]
fn eval_variables_are_used_by_dynamic_lookups() {
    let source = "function f(s) { let y = 1; eval(s); return () => [x, y]; }";
    with_walk(&[("main.cjs", source)], |hir, bound, walk| {
        let function = only_function(hir, FnKind::Decl);
        let variables = BindingRef::Slot(top_scope(bound, function), ScopeSlot::EvalVariables);
        assert!(has_use(walk, walked(walk, function), variables));
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert!(has_use(walk, arrow, variables));
    });
    let declared = "function f(s) { let y = 1; eval(s); return () => y; }";
    with_walk(&[("main.cjs", declared)], |hir, bound, walk| {
        let function = only_function(hir, FnKind::Decl);
        let variables = BindingRef::Slot(top_scope(bound, function), ScopeSlot::EvalVariables);
        let arrow = walked(walk, only_function(hir, FnKind::Arrow));
        assert!(!has_use(walk, arrow, variables));
    });
}
