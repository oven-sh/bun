use super::*;

case_tests! {
    const_alias: PROGRAM, "const m = Math; m.floor(1);", |case| {
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
        assert_eq!(case.symbol_id("m"), Some(BuiltinId::Math));
        assert!(!case.exposes(BuiltinId::Math));
    };
    alias_used_before_declaration: PROGRAM, "function f() { return m.floor; } const m = Math;", |case|
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
    alias_of_alias_in_any_order: PROGRAM, "function f() { const a = b.prototype; return a.push; } const b = Array;", |case|
        assert_builtin(case, "a.push", BuiltinId::ArrayPrototypePush);
    cyclic_aliases: PROGRAM, "const a = b, b = a; a;", |case| {
        assert_unresolved(case, "a");
        assert_eq!(case.symbol("a"), None);
        assert_eq!(case.symbol("b"), None);
    };
    destructuring: PROGRAM, "const { floor, ceil: c } = Math; floor(1); c(1);", |case| {
        assert_builtin(case, "floor", BuiltinId::MathFloor);
        assert_builtin(case, "c", BuiltinId::MathCeil);
        assert_eq!(case.symbol_id("floor"), Some(BuiltinId::MathFloor));
        assert_eq!(case.symbol_id("c"), Some(BuiltinId::MathCeil));
        assert!(!case.exposes(BuiltinId::Math));
    };
    nested_destructuring: PROGRAM, "const { prototype: { push } } = Array; push;", |case| {
        assert_builtin(case, "push", BuiltinId::ArrayPrototypePush);
        assert!(case.mentions(BuiltinId::ArrayPrototype));
        assert!(case.resolved.exposed().is_empty());
    };
    destructured_unknown_member: PROGRAM, "const { notThere } = Math; notThere;", |case| {
        assert_unresolved(case, "notThere");
        assert_eq!(case.symbol("notThere"), None);
        assert!(!case.exposes(BuiltinId::Math));
    };
    unstored_let_is_alias: PROGRAM, "let m = Math; m.floor;", |case| {
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
        assert!(!case.exposes(BuiltinId::Math));
    };
    stored_let_is_not_alias: PROGRAM, "let m = Math; m = other; m.floor;", |case| {
        assert_unresolved(case, "m.floor");
        assert_eq!(case.symbol("m"), None);
        assert!(case.mentions(BuiltinId::MathFloor));
        assert!(!case.exposes(BuiltinId::Math));
    };
    var_initialized_once_is_alias: PROGRAM, "var m = Math; m.floor;", |case|
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
    var_in_loop_is_not_alias: PROGRAM, "for (;;) { var m = Math; } m.floor;", |case| {
        assert_unresolved(case, "m.floor");
        assert!(case.mentions(BuiltinId::MathFloor));
        assert!(!case.exposes(BuiltinId::Math));
    };
    dead_store_is_ignored: PROGRAM, "let m = Math; if (false) m = other; m.floor;", |case|
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
    rest_exposes: PROGRAM, "const { floor, ...rest } = Math; rest;", |case| {
        assert_unresolved(case, "rest");
        assert!(case.exposes(BuiltinId::Math));
    };
    computed_key_exposes: PROGRAM, "const { [k]: f } = Math; f;", |case| {
        assert_unresolved(case, "f");
        assert!(case.exposes(BuiltinId::Math));
    };
    default_value_is_not_alias: PROGRAM, "const { floor = g } = Math; floor;", |case| {
        assert_unresolved(case, "floor");
        assert!(case.mentions(BuiltinId::MathFloor));
        assert!(!case.exposes(BuiltinId::Math));
    };
    array_pattern_exposes: PROGRAM, "const [a] = Array.prototype; a;", |case| {
        assert_unresolved(case, "a");
        assert!(case.exposes(BuiltinId::ArrayPrototype));
        assert!(!case.exposes(BuiltinId::Array));
    };
    operator_is_not_alias: PROGRAM, "const m = Math || other; m.floor;", |case| {
        assert_unresolved(case, "m.floor");
        assert!(case.mentions(BuiltinId::MathFloor));
        assert!(!case.exposes(BuiltinId::Math));
    };
    namespace_export_is_not_alias: PROGRAM, "namespace N { export const floor = Math.floor, m = Math; floor(1); m.ceil; }", |case| {
        assert_unresolved(case, "floor");
        assert_unresolved(case, "m.ceil");
        assert_eq!(case.symbol("floor"), None);
        assert_eq!(case.symbol("m"), None);
        assert!(case.mentions(BuiltinId::MathFloor));
        assert!(case.exposes(BuiltinId::Math));
    };
    destructured_namespace_export_is_not_alias: PROGRAM, "namespace N { export const { floor } = Math; floor(1); }", |case| {
        assert_unresolved(case, "floor");
        assert_eq!(case.symbol("floor"), None);
        assert!(case.mentions(BuiltinId::MathFloor));
    };
    namespace_local_is_alias: PROGRAM, "namespace N { const m = Math; m.floor; }", |case| {
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
        assert_eq!(case.symbol_id("m"), Some(BuiltinId::Math));
        assert!(!case.exposes(BuiltinId::Math));
    };
    alias_visible_to_eval: SCRIPT, "const m = Math; eval(s); m.floor;", |case| {
        assert_unresolved(case, "m.floor");
        assert!(case.exposes(BuiltinId::Math));
    };
    const_alias_beside_strict_eval: SCRIPT, "\"use strict\"; const m = Math; eval(s); m.floor;", |case| {
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
        assert!(case.exposes(BuiltinId::Math));
    };
    let_alias_beside_strict_eval: SCRIPT, "\"use strict\"; let m = Math; eval(s); m.floor;", |case| {
        assert_unresolved(case, "m.floor");
        assert!(case.exposes(BuiltinId::Math));
    };
    alias_in_with_scope: SCRIPT, "const m = Math; with (o) { m.floor; }", |case| {
        assert_unresolved(case, "m.floor");
        assert_unresolved(case, "m");
        assert!(case.exposes(BuiltinId::Math));
    };
    namespace_alias_stays_namespace: PROGRAM, "import * as jsc from \"bun:jsc\"; const j = jsc; j.default;", |case| {
        assert_builtin(case, "j.default", jsc_namespace());
        assert_unresolved(case, "j");
        assert_eq!(case.symbol("j"), None);
    };
}

#[test]
fn exported_alias_exposes() {
    for source in [
        "export const m = Math; m.floor;",
        "const m = Math; export { m }; m.floor;",
    ] {
        with_case(PROGRAM, source, |case| {
            assert!(case.exposes(BuiltinId::Math), "{source}");
            assert_builtin(case, "m.floor", BuiltinId::MathFloor);
        });
    }
}

#[test]
fn alias_is_predicted() {
    with_case(SCRIPT, "const r = require; r.resolve;", |case| {
        assert_mutability(case, "require", Mutability::AlwaysLocked);
        assert_builtin(case, "r", BuiltinId::ModuleRequire);
        assert_mutability(case, "r", Mutability::ConstantUnlessWritten);
        let symbol = case.symbol("r").unwrap();
        assert_eq!(symbol.mutability, Mutability::ConstantUnlessWritten);
        assert_builtin(case, "r.resolve", BuiltinId::ModuleRequireResolve);
        let member = case.path("r.resolve").unwrap();
        assert!(member.mutability <= Mutability::ConstantUnlessWritten);
    });
}

#[test]
fn entity_name_alias() {
    with_case(PROGRAM, "import serve = Bun.serve; serve();", |case| {
        assert_builtin(case, "serve", BuiltinId::BunServe);
        assert_mutability(case, "serve", Mutability::ConstantUnlessWritten);
        assert_eq!(case.symbol_id("serve"), Some(BuiltinId::BunServe));
        assert!(case.mentions(BuiltinId::Bun));
        assert!(case.mentions(BuiltinId::BunServe));
        assert!(case.resolved.exposed().is_empty());
    });
    with_case(PROGRAM, "import m = Math; m.floor;", |case| {
        assert_builtin(case, "m.floor", BuiltinId::MathFloor);
        assert!(!case.exposes(BuiltinId::Math));
    });
    let source = "import nothing = Math.notThere; nothing;";
    with_case(PROGRAM, source, |case| {
        assert_unresolved(case, "nothing");
        assert!(case.mentions(BuiltinId::Math));
    });
}

#[test]
fn exported_entity_name_alias_exposes() {
    with_case(PROGRAM, "export import m = Math; m.floor;", |case| {
        assert!(case.mentions(BuiltinId::Math));
        assert!(case.exposes(BuiltinId::Math));
        assert_eq!(case.symbol("m"), None);
    });
    with_case(PROGRAM, "export import serve = Bun.serve;", |case| {
        assert!(case.mentions(BuiltinId::BunServe));
        assert!(!case.exposes(BuiltinId::Bun));
    });
}

#[test]
fn entity_name_below_alias_exposes_alias() {
    let source = "import * as jsc from \"bun:jsc\"; import stats = jsc.heapStats; stats();";
    with_case(PROGRAM, source, |case| {
        assert_unresolved(case, "stats");
        assert!(case.mentions(jsc_namespace()));
        assert!(case.exposes(jsc_namespace()));
    });
}

#[test]
fn symbols_are_sorted() {
    let source = "const e = Math.exp, d = Math.floor, c = Math.ceil, b = Math.abs, a = Math.max;";
    with_case(PROGRAM, source, |case| {
        let expected = [
            ("a", BuiltinId::MathMax),
            ("b", BuiltinId::MathAbs),
            ("c", BuiltinId::MathCeil),
            ("d", BuiltinId::MathFloor),
            ("e", BuiltinId::MathExp),
        ];
        for (name, id) in expected {
            assert_eq!(case.symbol_id(name), Some(id), "{name}");
            assert!(case.mentions(id), "{name}");
        }
    });
}
