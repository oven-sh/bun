use super::*;

const fn defining(defines: &'static [DefinedPath]) -> Setup {
    Setup { defines, ..PROGRAM }
}

#[test]
fn dead_code() {
    with_case(PROGRAM, "if (false) { Bun.serve(); }", |case| {
        assert!(!case.mentions(BuiltinId::BunServe));
        assert!(!case.mentions(BuiltinId::Bun));
        assert_unresolved(case, "Bun.serve");
    });
    with_case(PROGRAM, "if (x) { Bun.serve(); }", |case| {
        assert!(case.mentions(BuiltinId::BunServe));
        assert_builtin(case, "Bun.serve", BuiltinId::BunServe);
    });
}

#[test]
fn dead_operand() {
    with_case(PROGRAM, "true || f(Math);", |case| {
        assert!(!case.mentions(BuiltinId::Math));
        assert!(!case.exposes(BuiltinId::Math));
    });
    with_case(PROGRAM, "false || f(Math);", |case| {
        assert!(case.exposes(BuiltinId::Math));
    });
}

#[test]
fn global_path_define() {
    let setup = defining(&[(&["MY", "floor"], &["Math", "floor"])]);
    with_case(setup, "MY.floor(1);", |case| {
        assert_builtin(case, "MY.floor", BuiltinId::MathFloor);
        assert!(case.mentions(BuiltinId::Math));
        assert!(case.mentions(BuiltinId::MathFloor));
        assert!(case.resolved.exposed().is_empty());
    });
    with_case(setup, "MY.ceil(1);", |case| {
        assert_unresolved(case, "MY.ceil");
        assert!(!case.mentions(BuiltinId::Math));
    });
}

#[test]
fn global_path_define_as_store_target() {
    let setup = defining(&[(&["RENAMED"], &["Math"])]);
    for source in ["RENAMED = x;", "RENAMED++;"] {
        with_case(setup, source, |case| {
            assert_builtin(case, "RENAMED", BuiltinId::Math);
            assert!(case.mentions(BuiltinId::Math), "{source}");
            assert!(!case.exposes(BuiltinId::Math), "{source}");
        });
    }
}

#[test]
fn exposed_global_path_define() {
    let setup = defining(&[(&["RENAMED"], &["Math"])]);
    with_case(setup, "f(RENAMED);", |case| {
        assert!(case.exposes(BuiltinId::Math))
    });
}

#[test]
fn decided_operands_are_not_evaluated() {
    let setup = defining(&[(&["process", "env", "X"], &["undefined"])]);
    with_case(setup, "process.env.X;", |case| {
        assert!(!case.mentions(BuiltinId::Process));
        assert!(!case.mentions(BuiltinId::ProcessEnv));
    });
    with_case(setup, "process.env.Y;", |case| {
        assert!(case.mentions(BuiltinId::Process));
        assert!(case.mentions(BuiltinId::ProcessEnv));
    });
}

#[test]
fn define_path_is_predicted() {
    let setup = defining(&[
        (&["MY", "now"], &["Date", "now"]),
        (&["MY", "iterator"], &["Symbol", "iterator"]),
    ]);
    with_case(setup, "MY.now; MY.iterator;", |case| {
        assert_mutability(case, "MY.now", Mutability::ConstantUnlessWritten);
        assert_builtin(case, "MY.iterator", BuiltinId::SymbolIterator);
        assert_mutability(case, "MY.iterator", Mutability::AlwaysLocked);
    });
}

#[test]
fn define_to_unknown_member() {
    let setup = defining(&[(&["MY"], &["Math", "nothing"])]);
    with_case(setup, "MY;", |case| {
        assert_unresolved(case, "MY");
        assert!(case.mentions(BuiltinId::Math));
    });
}

#[test]
fn define_to_unknown_global() {
    let setup = defining(&[(&["MY"], &["notAGlobal", "floor"])]);
    with_case(setup, "MY;", |case| {
        assert_unresolved(case, "MY");
        assert!(case.resolved.mentioned().is_empty());
    });
}
