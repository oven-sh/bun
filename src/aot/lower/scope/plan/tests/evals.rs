use bun_sema::bind::{CodeUnit, CommonJsVariable};
use bun_sema::hir::{FnKind, StmtKind};

use super::{COPIED, analyze_source, is_field, storage_in};
use crate::lower::captures::Capture;
use crate::lower::scope::{ArgumentsObject, BindingRef, ScopeSlot, Storage};

const EVAL_BETWEEN_DECLARATIONS: &str = "export function f(s) { \
    let a = 1; const b = 2; eval(s); const c = 3; return [a, b, c]; }";

#[test]
fn mutable_binding_seen_by_eval_has_a_field() {
    analyze_source("main.mjs", EVAL_BETWEEN_DECLARATIONS, |probe| {
        for name in ["a", "s"] {
            let placement = probe.placement_of(name);
            assert!(is_field(placement.storage), "{name}");
            assert!(!placement.has_local && !placement.is_immutable, "{name}");
            assert!(placement.is_shared, "{name}");
        }
    });
}

#[test]
fn const_seen_by_eval_stays_local() {
    analyze_source("main.mjs", EVAL_BETWEEN_DECLARATIONS, |probe| {
        assert_eq!(probe.placement_of("b"), COPIED);
        let later = probe.placement_of("c");
        assert!(is_field(later.storage));
        assert!(later.has_local && later.is_immutable);
        let fields = probe.environment_fields(probe.top_of("f"));
        assert!(!fields.contains(&probe.binding("b")));
        assert_eq!(fields.len(), 3);
    });
}

#[test]
fn indirect_eval_shares_nothing() {
    let source = "export function f(s) { let a = 1; return (0, eval)(s) + a; }";
    analyze_source("main.mjs", source, |probe| {
        let placement = probe.placement_of("a");
        assert_eq!(placement.storage, Storage::Local);
        assert!(!placement.is_shared);
    });
}

#[test]
fn entry_slots_seen_by_eval_stay_local() {
    analyze_source("main.mjs", EVAL_BETWEEN_DECLARATIONS, |probe| {
        let function = probe.function("f");
        let slots = [
            ScopeSlot::This,
            ScopeSlot::NewTarget,
            ScopeSlot::Arguments,
            ScopeSlot::ArgumentsBinding,
        ];
        for slot in slots {
            let placement = probe.placement(probe.slot(function, slot));
            assert_eq!(placement.storage, Storage::Local, "{slot:?}");
            assert!(placement.is_shared, "{slot:?}");
        }
    });
}

#[test]
fn eval_in_later_closure_takes_values() {
    let source = "export function f() { const a = 1; return (s) => eval(s); }";
    analyze_source("main.mjs", source, |probe| {
        let function = probe.function("f");
        let expected = [
            probe.copy_of("a"),
            Capture::Value(probe.slot(function, ScopeSlot::This)),
            Capture::Value(probe.slot(function, ScopeSlot::NewTarget)),
            Capture::Value(probe.slot(function, ScopeSlot::Arguments)),
            Capture::Value(probe.slot(function, ScopeSlot::ArgumentsBinding)),
        ];
        assert_eq!(probe.captures(probe.arrow()), expected);
        assert!(!probe.has_environment(probe.top_scope(function)));
    });
}

#[test]
fn eval_in_hoisted_function_needs_a_field() {
    let source = "export function f() { const a = 1; function g(s) { return eval(s); } return g; }";
    analyze_source("main.mjs", source, |probe| {
        let top = probe.top_of("f");
        assert!(is_field(probe.placement_of("a").storage));
        assert!(probe.captures_of("g").contains(&Capture::Environment(top)));
    });
}

#[test]
fn slot_stored_by_eval_has_a_field() {
    let exports_in = |source: &str| {
        analyze_source("main.cjs", source, |probe| {
            let slot = ScopeSlot::CommonJs(CommonJsVariable::Exports);
            probe
                .placement(BindingRef::Slot(probe.file_scope(), slot))
                .storage
        })
    };
    assert!(is_field(exports_in(
        "'use strict'; var text = ''; eval(text); exports.a = 1;"
    )));
    assert!(is_field(exports_in(
        "function f(text) { eval(text); } f(''); exports.a = 1;"
    )));
    let source = "var text = ''; (0, eval)(text); exports.a = 1;";
    analyze_source("main.cjs", source, |probe| {
        let slot = ScopeSlot::CommonJs(CommonJsVariable::Exports);
        assert_eq!(probe.analysis.placement(probe.file_slot(slot)), None);
    });

    let arguments_in = |source: &str| {
        analyze_source("main.cjs", source, |probe| {
            let slot = probe.slot(probe.function("probe"), ScopeSlot::ArgumentsBinding);
            probe.placement(slot).storage
        })
    };
    let sloppy = "function probe(text) { eval(text); return arguments; } module.exports = probe;";
    assert!(is_field(arguments_in(sloppy)));
    let strict = format!("'use strict'; {sloppy}");
    assert_eq!(arguments_in(&strict), Storage::Local);
}

#[test]
fn sloppy_eval_in_commonjs_body_maps_wrapper_parameters() {
    for source in [
        "var text = ''; eval(text); exports.a = 1;",
        "var text = ''; (() => eval(text))(); exports.a = 1;",
    ] {
        analyze_source("main.cjs", source, |probe| {
            let object = probe.analysis.arguments_object(CodeUnit::File);
            assert_eq!(object, ArgumentsObject::Mapped, "{source}");
            let exports = ScopeSlot::CommonJs(CommonJsVariable::Exports);
            assert_eq!(
                probe.analysis.placement(probe.file_slot(exports)),
                None,
                "{source}"
            );
            let binding = probe.placement(probe.file_slot(ScopeSlot::ArgumentsBinding));
            assert!(is_field(binding.storage), "{source}");
        });
    }
    let source = "function f(text) { eval(text); } f('');";
    analyze_source("main.cjs", source, |probe| {
        let object = probe.analysis.arguments_object(CodeUnit::File);
        assert_eq!(object, ArgumentsObject::None);
    });
}

#[test]
fn this_stored_by_eval_has_a_field() {
    let source = "class A {} class B extends A { constructor(text) { \
        while (text) { eval(text); text = ''; } } } new B('super()');";
    analyze_source("main.js", source, |probe| {
        let this = probe.slot(probe.only_function(FnKind::Constructor), ScopeSlot::This);
        let placement = probe.placement(this);
        assert!(is_field(placement.storage));
        assert!(!placement.has_local);
        let statement = probe.first_statement(|kind| matches!(kind, StmtKind::While { .. }));
        assert!(!probe.stored_in_loop(statement).contains(&this));
    });
}

#[test]
fn with_object_is_copied() {
    let source = "function f(o) { with (o) { return () => x; } } module.exports = f;";
    analyze_source("main.cjs", source, |probe| {
        let statement = probe.first_statement(|kind| matches!(kind, StmtKind::With { .. }));
        let scope = probe.bound.own_scope(statement);
        let object = BindingRef::Slot(scope, ScopeSlot::WithObject);
        assert_eq!(probe.bindings(scope), [object]);
        assert_eq!(probe.placement(object).storage, Storage::Local);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(object)]);
    });
}

#[test]
fn eval_variables_object_is_copied() {
    let source = "function f(s) { eval(s); return () => x; } module.exports = f;";
    analyze_source("main.cjs", source, |probe| {
        let variables = probe.slot(probe.function("f"), ScopeSlot::EvalVariables);
        assert_eq!(probe.placement(variables).storage, Storage::Local);
        assert_eq!(probe.captures(probe.arrow()), [Capture::Value(variables)]);
    });
    let strict = "export function f(s) { eval(s); return () => x; }";
    analyze_source("main.mjs", strict, |probe| {
        let variables = probe.slot(probe.function("f"), ScopeSlot::EvalVariables);
        assert_eq!(probe.analysis.placement(variables), None);
        assert!(probe.captures(probe.arrow()).is_empty());
    });
}

#[test]
fn top_level_binding_seen_by_eval_is_a_variable() {
    let source = "let a = 1; export function f(s) { return eval(s); }";
    assert!(matches!(
        storage_in("main.mjs", source, "a"),
        Storage::Variable(_)
    ));
    let unseen = "let a = 1; console.log(a); export function f(s) { return (0, eval)(s); }";
    assert_eq!(storage_in("main.mjs", unseen, "a"), Storage::Local);
}
