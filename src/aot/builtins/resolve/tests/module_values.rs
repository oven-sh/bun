use super::super::commonjs_variable_builtin;
use super::*;
use crate::builtins::table::Scope;
use bun_sema::bind::{Binding, CommonJsVariable};

const VARIABLES: [CommonJsVariable; 5] = [
    CommonJsVariable::Module,
    CommonJsVariable::Exports,
    CommonJsVariable::Require,
    CommonJsVariable::Filename,
    CommonJsVariable::Dirname,
];

fn variable_mutability(case: &Case<'_, '_>, variable: CommonJsVariable) -> Option<Mutability> {
    let path = case.resolved.commonjs_variable(variable);
    path.map(|path| path.mutability)
}

fn entry_mutability(id: BuiltinId) -> Mutability {
    table::entry(id).mutability
}

#[test]
fn roots() {
    with_case(SCRIPT, "module.exports = require;", |case| {
        for (text, id) in [
            ("module", BuiltinId::ModuleObject),
            ("require", BuiltinId::ModuleRequire),
        ] {
            assert_builtin(case, text, id);
            assert_mutability(case, text, Mutability::AlwaysLocked);
            assert_eq!(table::entry(id).scope, Scope::Module, "{text}");
        }
        let module = case.bound.binding(case.expr("module"));
        assert_eq!(module, Binding::CommonJs(CommonJsVariable::Module));
        assert_builtin(case, "module.exports", BuiltinId::ModuleObjectExports);
        assert_mutability(case, "module.exports", Mutability::ConstantUnlessWritten);
    });
    with_case(PROGRAM, "import.meta;", |case| {
        assert_builtin(case, "import.meta", BuiltinId::ImportMeta);
        assert_mutability(case, "import.meta", Mutability::AlwaysLocked);
        assert_eq!(table::entry(BuiltinId::ImportMeta).scope, Scope::Module);
    });
}

#[test]
fn members() {
    let commonjs_members = [
        ("require.resolve", BuiltinId::ModuleRequire, "resolve"),
        ("require.cache", BuiltinId::ModuleRequire, "cache"),
        ("require.main", BuiltinId::ModuleRequire, "main"),
        ("module.id", BuiltinId::ModuleObject, "id"),
        ("module.require", BuiltinId::ModuleObject, "require"),
    ];
    let source = "require.resolve; require.cache; require.main; module.id; module.require;";
    with_case(SCRIPT, source, |case| {
        for (text, root, name) in commonjs_members {
            let member = find_member(root, name);
            assert!(member.is_some(), "{text}");
            assert_eq!(case.builtin(text), member, "{text}");
        }
        assert!(case.resolved.exposed().is_empty());
    });
    let source = "import.meta.url; import.meta.require; import.meta.resolve;";
    with_case(PROGRAM, source, |case| {
        for name in ["url", "require", "resolve"] {
            let member = find_member(BuiltinId::ImportMeta, name);
            assert!(member.is_some(), "{name}");
            let found = case.builtin(&format!("import.meta.{name}"));
            assert_eq!(found, member, "{name}");
        }
    });
    with_case(SCRIPT, "require.notThere; module.notThere;", |case| {
        assert_unresolved(case, "require.notThere");
        assert_unresolved(case, "module.notThere");
    });
}

#[test]
fn member_mutability_is_of_location() {
    with_case(SCRIPT, "require.resolve; require.cache;", |case| {
        let resolve = entry_mutability(BuiltinId::ModuleRequireResolve);
        assert_mutability(case, "require.resolve", resolve);
        let cache = entry_mutability(BuiltinId::ModuleRequireCache);
        assert_mutability(case, "require.cache", cache);
    });
}

#[test]
fn five_variables() {
    let texts = [
        (CommonJsVariable::Require, "%ModuleRequire%"),
        (CommonJsVariable::Module, "%ModuleObject%"),
        (CommonJsVariable::Exports, "%ModuleObject%.exports"),
        (CommonJsVariable::Filename, "%ImportMeta%.path"),
        (CommonJsVariable::Dirname, "%ImportMeta%.dir"),
    ];
    for (variable, text) in texts {
        let builtin = commonjs_variable_builtin(variable);
        assert_eq!(builtin.map(table::text_of).as_deref(), Some(text));
    }
}

#[test]
fn commonjs_variables() {
    let source = "module; exports; require; __filename; __dirname;";
    with_case(SCRIPT, source, |case| {
        let texts = ["module", "exports", "require", "__filename", "__dirname"];
        for (variable, text) in VARIABLES.into_iter().zip(texts) {
            let path = BuiltinPath {
                id: commonjs_variable_builtin(variable).unwrap(),
                mutability: Mutability::AlwaysLocked,
            };
            let found = case.resolved.commonjs_variable(variable);
            assert_eq!(found, Some(path), "{text}");
            assert_eq!(case.path(text), Some(path), "{text}");
        }
    });
}

#[test]
fn es_module_variables() {
    let source = "export {}; require; __filename; __dirname; module; exports; typeof module;";
    with_case(PROGRAM, source, |case| {
        let reads = [
            (
                "require",
                CommonJsVariable::Require,
                BuiltinId::ImportMetaRequire,
            ),
            (
                "__filename",
                CommonJsVariable::Filename,
                BuiltinId::ImportMetaPath,
            ),
            (
                "__dirname",
                CommonJsVariable::Dirname,
                BuiltinId::ImportMetaDir,
            ),
        ];
        for (text, variable, location) in reads {
            let path = BuiltinPath {
                id: commonjs_variable_builtin(variable).unwrap(),
                mutability: entry_mutability(location),
            };
            assert!(
                path.mutability <= Mutability::ConstantUnlessWritten,
                "{text}"
            );
            assert_eq!(case.path(text), Some(path), "{text}");
            let found = case.resolved.commonjs_variable(variable);
            assert_eq!(found, Some(path), "{text}");
        }
        for free_name in case
            .exprs("module")
            .into_iter()
            .chain(case.exprs("exports"))
        {
            assert!(case.resolved_at(free_name).is_none());
        }
        let found = case.resolved.commonjs_variable(CommonJsVariable::Module);
        assert_eq!(found, None);
        let found = case.resolved.commonjs_variable(CommonJsVariable::Exports);
        assert_eq!(found, None);
        assert!(!case.mentions(BuiltinId::ModuleObject));
    });
}

#[test]
fn require_member_resolves_in_both_formats() {
    for (setup, source) in [
        (SCRIPT, "require.resolve;"),
        (PROGRAM, "export {}; require.resolve;"),
    ] {
        with_case(setup, source, |case| {
            assert_builtin(case, "require.resolve", BuiltinId::ModuleRequireResolve);
        });
    }
}

#[test]
fn exports_ignores_module_exports_store() {
    with_case(SCRIPT, "module.exports = f; exports.a = 1;", |case| {
        assert_builtin(case, "exports", BuiltinId::ModuleObjectExports);
        assert_mutability(case, "exports", Mutability::AlwaysLocked);
    });
}

#[test]
fn store_costs_one_variable() {
    with_case(SCRIPT, "require = f; module; require;", |case| {
        let predicted = Some(Mutability::ConstantUnlessWritten);
        let found = variable_mutability(case, CommonJsVariable::Require);
        assert_eq!(found, predicted);
        assert_mutability(case, "require", Mutability::ConstantUnlessWritten);
        for variable in VARIABLES {
            if variable != CommonJsVariable::Require {
                let locked = Some(Mutability::AlwaysLocked);
                assert_eq!(variable_mutability(case, variable), locked, "{variable:?}");
            }
        }
    });
}

#[test]
fn dead_store_costs_nothing() {
    with_case(SCRIPT, "if (false) require = f; require;", |case| {
        assert_mutability(case, "require", Mutability::AlwaysLocked);
    });
}

#[test]
fn direct_eval_weakens_all_variables() {
    for source in [
        "function f(s) { return eval(s); } require;",
        "\"use strict\"; function f(s) { return eval(s); } require;",
    ] {
        with_case(SCRIPT, source, |case| {
            for variable in VARIABLES {
                let predicted = Some(Mutability::ConstantUnlessWritten);
                let found = variable_mutability(case, variable);
                assert_eq!(found, predicted, "{variable:?}");
                assert!(case.mentions(commonjs_variable_builtin(variable).unwrap()));
            }
            assert_builtin(case, "require", BuiltinId::ModuleRequire);
            assert!(case.exposes(BuiltinId::ModuleRequire));
            assert!(case.exposes(BuiltinId::ModuleObject));
        });
    }
}

#[test]
fn dead_direct_eval_costs_nothing() {
    with_case(SCRIPT, "if (false) eval(s); require;", |case| {
        for variable in VARIABLES {
            let locked = Some(Mutability::AlwaysLocked);
            assert_eq!(variable_mutability(case, variable), locked, "{variable:?}");
        }
        assert!(!case.exposes(BuiltinId::ModuleRequire));
    });
}

#[test]
fn mapped_wrapper_arguments_weaken_all_variables() {
    for source in [
        "arguments[1] = f; require;",
        "const g = () => arguments; require;",
    ] {
        with_case(SCRIPT, source, |case| {
            for variable in VARIABLES {
                let predicted = Some(Mutability::ConstantUnlessWritten);
                let found = variable_mutability(case, variable);
                assert_eq!(found, predicted, "{variable:?}");
                assert!(case.mentions(commonjs_variable_builtin(variable).unwrap()));
            }
            assert_builtin(case, "require", BuiltinId::ModuleRequire);
            assert!(case.exposes(BuiltinId::ModuleRequire));
            assert!(case.exposes(BuiltinId::ModuleObject));
        });
    }
}

#[test]
fn unmapped_wrapper_arguments_expose_all_variables() {
    with_case(SCRIPT, "\"use strict\"; f(arguments); require;", |case| {
        for variable in VARIABLES {
            let locked = Some(Mutability::AlwaysLocked);
            assert_eq!(variable_mutability(case, variable), locked, "{variable:?}");
            assert!(case.mentions(commonjs_variable_builtin(variable).unwrap()));
        }
        assert!(case.exposes(BuiltinId::ModuleRequire));
        assert!(case.exposes(BuiltinId::ModuleObject));
    });
}

#[test]
fn other_arguments_objects_cost_nothing() {
    for source in [
        "function f() { return arguments; } require;",
        "if (false) arguments; require;",
    ] {
        with_case(SCRIPT, source, |case| {
            for variable in VARIABLES {
                let locked = Some(Mutability::AlwaysLocked);
                assert_eq!(variable_mutability(case, variable), locked, "{variable:?}");
            }
            assert!(!case.exposes(BuiltinId::ModuleRequire), "{source}");
        });
    }
}

#[test]
fn redeclared_variable() {
    with_case(SCRIPT, "var module = 1; module;", |case| {
        assert_unresolved(case, "module");
        assert!(matches!(
            case.bound.binding(case.expr("module")),
            Binding::Symbol(_)
        ));
    });
    with_case(SCRIPT, "function f(require) { return require; }", |case| {
        assert_unresolved(case, "require");
    });
}

#[test]
fn with_scope() {
    with_case(SCRIPT, "with (o) { require; }", |case| {
        assert_unresolved(case, "require");
        assert!(case.exposes(BuiltinId::ModuleRequire));
    });
}

#[test]
fn lazy_require_exposes_nothing() {
    let source = "exports.load = () => require(\"./impl\");";
    with_case(SCRIPT, source, |case| {
        assert!(case.mentions(BuiltinId::ModuleRequire));
        assert!(case.resolved.exposed().is_empty());
    });
}

#[test]
fn require_as_value() {
    with_case(SCRIPT, "f(require);", |case| {
        assert!(case.exposes(BuiltinId::ModuleRequire));
    });
    with_case(SCRIPT, "f(module);", |case| {
        assert!(case.exposes(BuiltinId::ModuleObject));
        assert!(!case.exposes(BuiltinId::ModuleRequire));
    });
}

#[test]
fn default_result_has_no_variables() {
    let resolved = ResolvedBuiltins::default();
    for variable in VARIABLES {
        assert_eq!(resolved.commonjs_variable(variable), None);
    }
    assert!(resolved.of_expr(ExprId(0)).is_none());
    assert!(resolved.mentioned().is_empty() && resolved.exposed().is_empty());
    assert!(resolved.evaluated_texts().is_empty());
    assert_eq!(resolved.loaded_modules().count(), 0);
    assert_eq!(resolved.called_functions().count(), 0);
}
