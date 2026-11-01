mod support;
use support::*;

use BindingStability::{
    ContainerMember, Linked, MappedArgument, NoBinding, NotInitializedOnce, Stable, Stored,
    VisibleToEval,
};

const VARIABLES: &[(&str, &str, BindingStability)] = &[
    ("a.mjs", "const v = 1;", Stable),
    ("a.mjs", "let v = 1;", Stable),
    ("a.mjs", "let v;", Stable),
    ("a.mjs", "let v; v = 1;", Stored),
    ("a.mjs", "let v = 1; v += 1;", Stored),
    ("a.mjs", "let v = 1; v++;", Stored),
    ("a.mjs", "let v = 1; [v] = [2];", Stored),
    ("a.mjs", "let v = 1; ({ a: v } = {});", Stored),
    ("a.mjs", "let v = 1; ({ v = 2 } = {});", Stored),
    ("a.mjs", "let v = 1; for (v in {}) {}", Stored),
    ("a.mjs", "let v = 1; for (v of []) {}", Stored),
    ("a.mjs", "let v = 1; (v) = 2;", Stored),
    ("a.ts", "let v = 1; (v as number) = 2;", Stored),
    ("a.ts", "let v = 1; v! = 2;", Stored),
    ("a.mjs", "let v = 1; function f() { v = 2; }", Stored),
    ("a.mjs", "const v = 1; v = 2;", Stable),
    ("a.mjs", "for (const v of []) {}", Stable),
    ("a.mjs", "for (let v in {}) {}", Stable),
    ("a.mjs", "for (let v = 0; ; ) {}", Stable),
    ("a.mjs", "for (let v = 0; ; v++) {}", Stored),
    ("a.mjs", "while (a) { let v = 1; }", Stable),
    ("a.mjs", "try {} catch (v) {}", Stable),
    ("a.mjs", "try {} catch ({ v }) {}", Stable),
    ("a.mjs", "try {} catch (v) { v = 1; }", Stored),
    ("a.mjs", "const { v } = o;", Stable),
    ("a.mjs", "const [v] = o;", Stable),
    ("a.mjs", "export let v = 1;", Stable),
    ("a.mjs", "export let v = 1; v = 2;", Stored),
    ("a.cjs", "var v;", Stable),
    ("a.cjs", "var v = 1;", Stable),
    ("a.cjs", "var v = 1; var v;", Stable),
    ("a.cjs", "var v = 1; var v = 2;", NotInitializedOnce),
    ("a.cjs", "{ var v = 1; }", Stable),
    ("a.cjs", "if (a) { var v = 1; }", Stable),
    ("a.cjs", "while (a) { var v = 1; }", NotInitializedOnce),
    ("a.cjs", "do { var v = 1; } while (a);", NotInitializedOnce),
    ("a.cjs", "for (;;) { var v = 1; }", NotInitializedOnce),
    ("a.cjs", "for (var v = 0; ; ) {}", Stable),
    ("a.cjs", "for (var v in {}) {}", NotInitializedOnce),
    ("a.cjs", "for (var v of []) {}", NotInitializedOnce),
    (
        "a.cjs",
        "for (const a of []) { var v = 1; }",
        NotInitializedOnce,
    ),
    (
        "a.cjs",
        "while (a) { (function () { var v = 1; }); }",
        Stable,
    ),
    ("a.cjs", "var v = 1; function v() {}", NotInitializedOnce),
    ("a.cjs", r#"const v = require("m");"#, Stable),
    ("a.cjs", r#"{ const v = require("m"); }"#, Stable),
    ("a.cjs", r#"let v = 1; eval("");"#, VisibleToEval),
    ("a.cjs", r#"var v = 1; eval("");"#, VisibleToEval),
    ("a.cjs", r#"const v = 1; eval("");"#, Stable),
    ("a.cjs", r#"let v = 1; (0, eval)("");"#, Stable),
    (
        "a.cjs",
        r#"function f() { eval(""); } { let v = 1; }"#,
        Stable,
    ),
    ("a.ts", "declare const v: number;", NoBinding),
    (
        "a.ts",
        "namespace N { export const v = 1; }",
        ContainerMember,
    ),
    ("a.ts", "namespace N { const v = 1; }", Stable),
];

const PARAMETERS: &[(&str, &str, BindingStability)] = &[
    ("a.cjs", "function f(p) {}", Stable),
    ("a.cjs", "function f(p) { p = 1; }", Stored),
    ("a.cjs", "function f(p = 1) {}", Stable),
    ("a.cjs", "function f({ p }) {}", Stable),
    ("a.cjs", "function f(...p) {}", Stable),
    ("a.cjs", "function f(p, p) {}", NotInitializedOnce),
    ("a.cjs", "function f(p) { arguments; }", MappedArgument),
    (
        "a.cjs",
        "function f(p) { () => arguments; }",
        MappedArgument,
    ),
    (
        "a.cjs",
        "function f(p) { function g() { arguments; } }",
        Stable,
    ),
    (
        "a.cjs",
        r#"function f(p) { "use strict"; arguments; }"#,
        MappedArgument,
    ),
    (
        "a.cjs",
        r#""use strict"; function f(p) { arguments; }"#,
        Stable,
    ),
    ("a.cjs", "class C { m(p) { arguments; } }", Stable),
    ("a.mjs", "function f(p) { arguments; }", Stable),
    ("a.cjs", "function f(p = 1) { arguments; }", Stable),
    ("a.cjs", "function f(p, ...q) { arguments; }", Stable),
    ("a.cjs", "function f({ p }) { arguments; }", Stable),
    ("a.cjs", "function f(p) { var p; }", Stable),
    ("a.cjs", "function f(p) { var p = 1; }", NotInitializedOnce),
    ("a.cjs", r#"function f(p) { eval(""); }"#, VisibleToEval),
];

const WRAPPER_PARAMETERS: &[(&str, &str, BindingStability)] = &[
    ("a.cjs", "var exports; arguments;", MappedArgument),
    ("a.cjs", "var exports; () => arguments;", MappedArgument),
    ("a.cjs", "var exports;", Stable),
    ("a.cjs", "var exports; function f() { arguments; }", Stable),
    ("a.cjs", r#""use strict"; var exports; arguments;"#, Stable),
    (
        "a.cjs",
        "var other; var exports; arguments;",
        MappedArgument,
    ),
];

const FUNCTIONS: &[(&str, &str, BindingStability)] = &[
    ("a.mjs", "function f() {}", Stable),
    ("a.mjs", "function f() {} f = 1;", Stored),
    (
        "a.cjs",
        "function f() {} function f() {}",
        NotInitializedOnce,
    ),
    ("a.mjs", "{ function f() {} }", Stable),
    ("a.mjs", "(function f() { f = 1; });", Stable),
    ("a.mjs", "export default function f() {}", Stable),
    (
        "a.ts",
        "function f(a: number): void; function f(a: any) {}",
        Stable,
    ),
    (
        "a.ts",
        "function f() {} namespace f { export const a = 1; }",
        Stable,
    ),
    ("a.cjs", r#"function f() {} eval("");"#, VisibleToEval),
    ("a.cjs", r#"(function f() { eval(""); });"#, Stable),
];

const CLASSES: &[(&str, &str, BindingStability)] = &[
    ("a.mjs", "class C {}", Stable),
    ("a.mjs", "class C {} C = 1;", Stored),
    ("a.mjs", "export class C {}", Stable),
    ("a.mjs", "export default class C {}", Stable),
    (
        "a.ts",
        "class C {} namespace C { export const a = 1; }",
        Stable,
    ),
    ("a.ts", "declare class C {}", NoBinding),
    ("a.cjs", r#"class C {} eval("");"#, VisibleToEval),
];

fn assert_stability(s: &Analyzed<'_>, symbol: SymbolId, expected: BindingStability, text: &str) {
    assert_eq!(s.bound.binding_stability(symbol), expected, "{text}");
    assert_eq!(
        s.bound.is_stable_binding(symbol),
        expected == Stable,
        "{text}"
    );
}

#[test]
fn variables() {
    for &(path, text, expected) in VARIABLES {
        analyzed(path, text, |s| {
            assert_stability(s, s.variable("v", 0), expected, text)
        });
    }
}

#[test]
fn parameters() {
    for &(path, text, expected) in PARAMETERS {
        analyzed(path, text, |s| {
            assert_stability(s, s.parameter("p", 0), expected, text)
        });
    }
}

#[test]
fn redeclared_wrapper_parameters() {
    for &(path, text, expected) in WRAPPER_PARAMETERS {
        analyzed(path, text, |s| {
            assert_stability(s, s.variable("exports", 0), expected, text)
        });
    }
    analyzed("a.cjs", "var other; arguments;", |s| {
        assert_stability(s, s.variable("other", 0), Stable, "other");
    });
}

#[test]
fn functions() {
    for &(path, text, expected) in FUNCTIONS {
        analyzed(path, text, |s| {
            assert_stability(s, s.function_symbol("f"), expected, text)
        });
    }
}

#[test]
fn classes() {
    for &(path, text, expected) in CLASSES {
        analyzed(path, text, |s| {
            assert_stability(s, s.class_symbol("C"), expected, text)
        });
    }
}

#[test]
fn inner_class_name_ignores_stores() {
    analyzed("a.mjs", "class C { m() { C = 1; } }", |s| {
        let inner = s.bound.inner_class_symbol(s.class("C"));
        assert_eq!(s.bound.stores_to(inner).len(), 1);
        assert_stability(s, inner, Stable, "inner");
        assert_stability(s, s.class_symbol("C"), Stable, "outer");
    });
}

#[test]
fn imports_are_linked() {
    let text = r#"import a, { b } from "m"; import * as c from "m";"#;
    analyzed("a.mjs", text, |s| {
        let declarations = [
            Decl::ImportDefault(ImportId(0)),
            Decl::ImportSpec(ImportSpecId(0)),
            Decl::ImportNamespace(ImportId(1)),
        ];
        for decl in declarations {
            let symbol = s.bound.declared_symbol(decl);
            assert_stability(s, symbol, Linked, text);
            assert_eq!(
                s.bound.binding_initializer(&s.hir, symbol),
                BindingInitializer::Import
            );
        }
    });
}

#[test]
fn annex_b_variable() {
    analyzed("a.cjs", "{ function f() {} }", |s| {
        let [hoisted] = s.bound.runtime.annex_b_functions()[..] else {
            panic!("one function is hoisted");
        };
        assert_stability(s, hoisted.var_symbol, Stable, "var");
        assert_stability(s, hoisted.block_symbol, Stable, "block");
        assert_eq!(
            s.bound.initial_state(hoisted.var_symbol),
            InitialState::Undefined
        );
        assert_eq!(
            s.bound.initial_state(hoisted.block_symbol),
            InitialState::Initialized
        );
    });
    analyzed("a.cjs", "while (a) { function f() {} }", |s| {
        let [hoisted] = s.bound.runtime.annex_b_functions()[..] else {
            panic!("one function is hoisted");
        };
        assert_stability(s, hoisted.var_symbol, NotInitializedOnce, "var");
        assert_stability(s, hoisted.block_symbol, Stable, "block");
    });
}

#[test]
fn dead_stores_can_be_ignored() {
    analyzed("a.mjs", "let v = 1; if (false) v = 2;", |s| {
        let symbol = s.variable("v", 0);
        let [store] = s.bound.stores_to(symbol)[..] else {
            panic!("one store");
        };
        assert!(s.bound.is_store_target(store.target));
        assert_eq!(s.bound.binding_stability(symbol), Stored);
        let ignoring = |ignored: ExprId| {
            s.bound
                .binding_stability_ignoring(symbol, &|target| target == ignored)
        };
        assert_eq!(ignoring(store.target), Stable);
        assert_eq!(ignoring(ExprId::NONE), Stored);
    });
}

#[test]
fn initial_states() {
    const STATES: &[(&str, &str, InitialState)] = &[
        ("a.cjs", "var v = 1;", InitialState::Undefined),
        ("a.cjs", "let v = 1;", InitialState::Uninitialized),
        ("a.cjs", "const v = 1;", InitialState::Uninitialized),
        ("a.cjs", "try {} catch (v) {}", InitialState::Initialized),
        (
            "a.cjs",
            "try {} catch ({ v }) {}",
            InitialState::Uninitialized,
        ),
    ];
    for &(path, text, expected) in STATES {
        analyzed(path, text, |s| {
            assert_eq!(
                s.bound.initial_state(s.variable("v", 0)),
                expected,
                "{text}"
            );
        });
    }
    analyzed("a.cjs", "function f(p) {} class C {}", |s| {
        assert_eq!(
            s.bound.initial_state(s.parameter("p", 0)),
            InitialState::Initialized
        );
        assert_eq!(
            s.bound.initial_state(s.function_symbol("f")),
            InitialState::Initialized
        );
        assert_eq!(
            s.bound.initial_state(s.class_symbol("C")),
            InitialState::Uninitialized
        );
    });
    analyzed("a.cjs", "function f(p, q = p) {}", |s| {
        assert_eq!(
            s.bound.initial_state(s.parameter("p", 0)),
            InitialState::Uninitialized
        );
    });
    analyzed(
        "a.ts",
        "enum E {} namespace N { export const a = 1; }",
        |s| {
            let container = s.bound.declared_symbol(Decl::Enum(EnumId(0)));
            assert_eq!(s.bound.initial_state(container), InitialState::Undefined);
            let container = s.bound.declared_symbol(Decl::Module(ModuleId(0)));
            assert_eq!(s.bound.initial_state(container), InitialState::Undefined);
        },
    );
}

#[test]
fn initializers() {
    analyzed("a.mjs", "const v = f();", |s| {
        let call = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Call(_)))[0];
        let initializer = s.bound.binding_initializer(&s.hir, s.variable("v", 0));
        assert_eq!(initializer, BindingInitializer::Expression(call));
    });
    analyzed("a.mjs", "const { a: { b: v } } = o;", |s| {
        let BindingInitializer::PatternProperty { source, path } =
            s.bound.binding_initializer(&s.hir, s.variable("v", 0))
        else {
            panic!("a property of a pattern");
        };
        assert_eq!(source, s.ident("o", 0));
        assert_eq!(path[..], [s.workspace.atom("a"), s.workspace.atom("b")]);
    });
    const OPAQUE: &[&str] = &[
        "let v;",
        "const [v] = o;",
        "const { v = 1 } = o;",
        "const { ...v } = o;",
        "const { [k]: v } = o;",
        "const { a: [v] } = o;",
        "for (const v of o) {}",
        "try {} catch (v) {}",
        "var v = 1; var v = 2;",
    ];
    for &text in OPAQUE {
        analyzed("a.cjs", text, |s| {
            let initializer = s.bound.binding_initializer(&s.hir, s.variable("v", 0));
            assert_eq!(initializer, BindingInitializer::Opaque, "{text}");
        });
    }
    analyzed(
        "a.mjs",
        "function f(p) {} class C {} export default 1;",
        |s| {
            let initializer = |symbol| s.bound.binding_initializer(&s.hir, symbol);
            let function = BindingInitializer::Function(s.function("f"));
            assert_eq!(initializer(s.function_symbol("f")), function);
            let class = BindingInitializer::Class(s.class("C"));
            assert_eq!(initializer(s.class_symbol("C")), class);
            assert_eq!(initializer(s.bound.inner_class_symbol(s.class("C"))), class);
            assert_eq!(initializer(s.parameter("p", 0)), BindingInitializer::Opaque);
        },
    );
}

#[test]
fn symbol_past_end_is_no_binding() {
    analyzed("a.mjs", "", |s| {
        let past_end = SymbolId(s.bound.symbols.len() as u32);
        assert_eq!(s.bound.binding_stability(past_end), NoBinding);
        assert_eq!(s.bound.binding_stability(SymbolId::NONE), NoBinding);
        let initializer = s.bound.binding_initializer(&s.hir, past_end);
        assert_eq!(initializer, BindingInitializer::Opaque);
    });
}

#[test]
fn every_program_has_one_verdict_per_symbol() {
    for_each_program(&SOURCE_EXTENSIONS, |workspace, path, text| {
        let s = workspace.analyze(&Source::from_bytes(path, text));
        if s.bound.ran_out_of_stack {
            return;
        }
        for symbol in symbols_of(&s.bound) {
            let has_binding = s.bound.binding_kind(symbol) != BindingKind::NoBinding;
            let stability = s.bound.binding_stability(symbol);
            assert_eq!(stability != NoBinding, has_binding, "{path}: {symbol:?}");
        }
    });
}
