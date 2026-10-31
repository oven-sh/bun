use super::*;
use bun_sema::bind::Binding;

case_tests! {
    shadowed: PROGRAM, "function f(Math: any) { return Math.floor; }", |case| {
        assert_unresolved(case, "Math.floor");
        assert_unresolved(case, "Math");
        assert!(!case.mentions(BuiltinId::Math));
    };
    local_declaration: PROGRAM, "const Array = 1; Array;", |case| {
        assert_unresolved(case, "Array");
        assert!(!case.mentions(BuiltinId::Array));
    };
    arguments_object: PROGRAM, "function f() { return arguments; }", |case| {
        assert_unresolved(case, "arguments");
        let binding = case.bound.binding(case.expr("arguments"));
        assert!(matches!(binding, Binding::Arguments(_)));
    };
    unknown_name_in_dynamic_scope: SCRIPT, "with (o) { notAGlobal; }", |case|
        assert_unresolved(case, "notAGlobal");
    unevaluated_identifier: PROGRAM, "declare const x: typeof Math; export {};", |case| {
        assert!(case.resolved.mentioned().is_empty());
        assert!(case.resolved.exposed().is_empty());
    };
}

#[test]
fn with_statement() {
    let source = "with (o) { Math.floor(1); } Math.ceil(1);";
    with_case(SCRIPT, source, |case| {
        assert_unresolved(case, "Math.floor");
        let inside = case.exprs("Math")[0];
        let expected = BuiltinPath {
            id: BuiltinId::Math,
            mutability: Mutability::ConstantUnlessWritten,
        };
        assert_eq!(case.dynamic_global_at(inside), Some(expected));
        assert_eq!(case.path_at(inside), None);
        assert_eq!(case.resolved.builtin_of_expression(inside), None);
        assert!(case.mentions(BuiltinId::Math));
        assert!(case.exposes(BuiltinId::Math));
        assert!(!case.mentions(BuiltinId::MathFloor));
        assert_builtin(case, "Math.ceil", BuiltinId::MathCeil);
        assert_eq!(case.dynamic_global_at(case.expr("Math")), None);
    });
}

#[test]
fn locked_global_in_dynamic_scope_is_predicted() {
    with_case(SCRIPT, "with (o) { Symbol; } Symbol;", |case| {
        let inside = case.exprs("Symbol")[0];
        let found = case.dynamic_global_at(inside).unwrap();
        assert_eq!(found.id, BuiltinId::Symbol);
        assert_eq!(found.mutability, Mutability::ConstantUnlessWritten);
        assert_mutability(case, "Symbol", Mutability::AlwaysLocked);
    });
}

#[test]
fn sloppy_direct_eval() {
    let sloppy = [
        "function f(s) { eval(s); return Math.floor; }",
        r#"function f(s) { "use strict"; eval(s); return Math.floor; }"#,
    ];
    for source in sloppy {
        with_case(SCRIPT, source, |case| {
            assert_unresolved(case, "Math.floor");
            assert!(case.dynamic_global_at(case.expr("Math")).is_some());
            assert!(case.exposes(BuiltinId::Math));
        });
    }
    let strict = [
        r#""use strict"; function f(s) { eval(s); return Math.floor; }"#,
        "class C { m(s) { eval(s); return Math.floor; } }",
    ];
    for source in strict {
        with_case(SCRIPT, source, |case| {
            assert_builtin(case, "Math.floor", BuiltinId::MathFloor);
            assert!(!case.exposes(BuiltinId::Math));
        });
    }
}

#[test]
fn direct_eval_in_other_function() {
    let source = "function f(s) { eval(s); } function g() { return Math.floor; }";
    with_case(SCRIPT, source, |case| {
        assert_builtin(case, "Math.floor", BuiltinId::MathFloor);
    });
}

const BUILTIN_PATHS: &[DefinedPath] = &[
    (&["PROBE_FLOOR"], &["Math", "floor"]),
    (&["PROBE_SYMBOL"], &["Symbol"]),
    (&["process", "env", "PROBE"], &["Symbol"]),
    (&["settle"], &["Symbol", "for"]),
];

#[test]
fn defined_path_of_a_builtin_below_a_binding_is_no_builtin() {
    let setup = Setup {
        defines: BUILTIN_PATHS,
        ..SCRIPT
    };
    let sites = [
        ("function f(Math) { return PROBE_FLOOR; }", "PROBE_FLOOR"),
        (
            "function f(Symbol) { return typeof PROBE_SYMBOL; }",
            "PROBE_SYMBOL",
        ),
        (
            "function f(Symbol) { return process.env.PROBE; }",
            "process.env.PROBE",
        ),
        ("function f(Symbol) { return settle(1); }", "settle"),
    ];
    for (source, site) in sites {
        with_case(setup, source, |case| {
            assert_unresolved(case, site);
            assert!(case.resolved.mentioned().is_empty(), "{source}");
        });
    }
}

#[test]
fn defined_name_after_a_direct_eval_resolves_as_the_name_written_there() {
    let setup = Setup {
        defines: BUILTIN_PATHS,
        ..SCRIPT
    };
    let source = "function f(s) { eval(s); return [PROBE_SYMBOL, process.env.PROBE, Symbol]; }";
    with_case(setup, source, |case| {
        let written = case.dynamic_global_at(case.expr("Symbol"));
        assert_eq!(written.map(|path| path.id), Some(BuiltinId::Symbol));
        for defined in ["PROBE_SYMBOL", "process.env.PROBE"] {
            let site = case.expr(defined);
            assert_eq!(case.dynamic_global_at(site), written, "{defined}");
        }
    });
    // The text of the eval may declare `Math`, so nothing is known of a member below that name.
    let source = "function f(s) { eval(s); return PROBE_FLOOR; }";
    with_case(setup, source, |case| {
        assert_unresolved(case, "PROBE_FLOOR");
        assert!(case.mentions(BuiltinId::Math));
    });
    // The text of an eval in strict code declares nothing in the function.
    let source = r#""use strict"; function f(s) { eval(s); return PROBE_FLOOR; }"#;
    with_case(setup, source, |case| {
        assert_builtin(case, "PROBE_FLOOR", BuiltinId::MathFloor);
    });
}
