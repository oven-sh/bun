mod support;
use support::*;

const VARIABLES: &[(&str, &str, BindingKind)] = &[
    ("a.cjs", "var v;", BindingKind::Var),
    ("a.cjs", "let v;", BindingKind::Let),
    ("a.cjs", "const v = 1;", BindingKind::Const),
    ("a.mjs", "{ using v = null; }", BindingKind::Const),
    ("a.mjs", "{ await using v = null; }", BindingKind::Const),
    ("a.cjs", "for (const v of []) {}", BindingKind::Const),
    ("a.cjs", "for (let v in {}) {}", BindingKind::Let),
    (
        "a.cjs",
        "try {} catch (v) {}",
        BindingKind::SimpleCatchParameter,
    ),
    ("a.cjs", "try {} catch ({ v }) {}", BindingKind::Let),
    ("a.cjs", r#"var v = require("m");"#, BindingKind::Var),
    ("a.cjs", r#"const v = require("m");"#, BindingKind::Const),
    (
        "a.cjs",
        r#"{ const v = require("m"); }"#,
        BindingKind::Const,
    ),
    ("a.cjs", r#"{ let v = require("m"); }"#, BindingKind::Let),
    ("a.ts", "declare const v: number;", BindingKind::NoBinding),
    ("a.ts", "declare var v: number;", BindingKind::NoBinding),
];

const FUNCTIONS: &[(&str, BindingKind)] = &[
    ("function f() {}", BindingKind::Function),
    ("{ function f() {} }", BindingKind::Function),
    ("{ async function f() {} }", BindingKind::Function),
    ("{ function* f() {} }", BindingKind::Function),
    ("(function f() {});", BindingKind::FunctionName),
    ("if (a) function f() {}", BindingKind::Function),
    ("if (a) ; else function f() {}", BindingKind::Function),
];

const IMPORTS: &[(&str, &str, Decl, BindingKind)] = &[
    (
        "a.mjs",
        r#"import { a } from "m";"#,
        Decl::ImportSpec(ImportSpecId(0)),
        BindingKind::Import,
    ),
    (
        "a.mjs",
        r#"import a from "m";"#,
        Decl::ImportDefault(ImportId(0)),
        BindingKind::Import,
    ),
    (
        "a.mjs",
        r#"import * as a from "m";"#,
        Decl::ImportNamespace(ImportId(0)),
        BindingKind::Import,
    ),
    (
        "a.ts",
        r#"import type { a } from "m";"#,
        Decl::ImportSpec(ImportSpecId(0)),
        BindingKind::NoBinding,
    ),
    (
        "a.ts",
        r#"import a = require("m");"#,
        Decl::ImportEquals(ImportEqualsId(0)),
        BindingKind::Const,
    ),
    (
        "a.ts",
        r#"import type a = require("m");"#,
        Decl::ImportEquals(ImportEqualsId(0)),
        BindingKind::NoBinding,
    ),
];

fn declared_kind(s: &Analyzed<'_>, decl: Decl) -> BindingKind {
    s.bound.binding_kind(s.bound.declared_symbol(decl))
}

fn function_kind(s: &Analyzed<'_>, name: &str) -> BindingKind {
    declared_kind(s, Decl::Fn(s.function(name)))
}

#[test]
fn variables() {
    for &(path, text, kind) in VARIABLES {
        analyzed(path, text, |s| {
            assert_eq!(s.bound.binding_kind(s.variable("v", 0)), kind, "{text}");
        });
    }
}

const HOISTED_VARIABLES: &[(&str, BindingKind, InitialState)] = &[
    ("let v;", BindingKind::Var, InitialState::Undefined),
    ("let v = 1;", BindingKind::Var, InitialState::Undefined),
    ("const v = 1;", BindingKind::Var, InitialState::Undefined),
    (
        "const { v } = {};",
        BindingKind::Var,
        InitialState::Undefined,
    ),
    (
        "export const v = 1;",
        BindingKind::Var,
        InitialState::Undefined,
    ),
    ("{ let v; }", BindingKind::Let, InitialState::Uninitialized),
    (
        "{ const v = 1; }",
        BindingKind::Const,
        InitialState::Uninitialized,
    ),
    (
        "function f() { const v = 1; }",
        BindingKind::Const,
        InitialState::Uninitialized,
    ),
    (
        "for (let v = 0; ; ) {}",
        BindingKind::Let,
        InitialState::Uninitialized,
    ),
    (
        "for (const v of []) {}",
        BindingKind::Const,
        InitialState::Uninitialized,
    ),
    (
        "using v = null;",
        BindingKind::Const,
        InitialState::Uninitialized,
    ),
];

#[test]
fn top_level_variables_of_hoisting_file() {
    let runtime = RuntimeBindOptions {
        hoists_top_level_variables: true,
        ..Default::default()
    };
    for &(text, kind, initial_state) in HOISTED_VARIABLES {
        let source = Source {
            runtime,
            ..Source::new("a.mts", text)
        };
        analyzed_source(&source, |s| {
            let symbol = s.variable("v", 0);
            assert_eq!(s.bound.binding_kind(symbol), kind, "{text}");
            assert_eq!(s.bound.initial_state(symbol), initial_state, "{text}");
        });
    }
    let source = Source {
        runtime,
        ..Source::new("a.mts", "class C {}")
    };
    analyzed_source(&source, |s| {
        assert_eq!(
            declared_kind(s, Decl::Class(ClassId(0))),
            BindingKind::Class
        );
    });
    analyzed("a.mts", "const v = 1;", |s| {
        let symbol = s.variable("v", 0);
        assert_eq!(s.bound.binding_kind(symbol), BindingKind::Const);
        assert_eq!(s.bound.initial_state(symbol), InitialState::Uninitialized);
    });
}

#[test]
fn functions() {
    for &(text, kind) in FUNCTIONS {
        analyzed("a.cjs", text, |s| {
            assert_eq!(function_kind(s, "f"), kind, "{text}")
        });
    }
    analyzed("a.ts", "declare function f(): void;", |s| {
        assert_eq!(declared_kind(s, Decl::Fn(FnId(0))), BindingKind::NoBinding);
    });
    analyzed("a.ts", "function f(): void; function f() {}", |s| {
        assert_eq!(function_kind(s, "f"), BindingKind::Function);
    });
}

#[test]
fn annex_b_variables() {
    for text in ["{ function f() {} }", "if (a) function f() {}"] {
        analyzed("a.cjs", text, |s| {
            let [hoist] = s.bound.runtime.annex_b_functions()[..] else {
                panic!("{text}: {:?}", s.bound.runtime.annex_b_functions());
            };
            assert_eq!(
                s.bound.binding_kind(hoist.var_symbol),
                BindingKind::Var,
                "{text}"
            );
        });
    }
}

#[test]
fn hidden_table_symbol_has_no_kind() {
    analyzed("a.cjs", "if (a) function f() {}", |s| {
        let table_symbol = s.bound.fn_symbol[s.function("f").idx()];
        assert_eq!(s.bound.binding_kind(table_symbol), BindingKind::NoBinding);
    });
    analyzed("a.cjs", r#"{ const v = require("m"); }"#, |s| {
        let table_symbol = s.bound.pat_symbol[s.pat("v", 0).idx()];
        assert_ne!(table_symbol, s.variable("v", 0));
        assert_eq!(s.bound.binding_kind(table_symbol), BindingKind::NoBinding);
    });
}

#[test]
fn parameters() {
    for text in ["function f(p) {}", "function f(p) { var p; }"] {
        analyzed("a.cjs", text, |s| {
            let kind = declared_kind(s, Decl::Param(s.pat("p", 0)));
            assert_eq!(kind, BindingKind::Parameter, "{text}");
        });
    }
    analyzed("a.ts", "function f(this: Window) {}", |s| {
        let kind = declared_kind(s, Decl::Param(s.pat("this", 0)));
        assert_eq!(kind, BindingKind::NoBinding);
    });
    analyzed("a.ts", "declare function f(p: number): void;", |s| {
        let kind = declared_kind(s, Decl::Param(s.pat("p", 0)));
        assert_eq!(kind, BindingKind::NoBinding);
    });
}

#[test]
fn body_variables() {
    analyzed("a.cjs", "function f(p, q = () => p) { var p; }", |s| {
        let [copy] = s.bound.runtime.parameter_var_copies()[..] else {
            panic!("{:?}", s.bound.runtime.parameter_var_copies());
        };
        assert_eq!(s.bound.binding_kind(copy.parameter), BindingKind::Parameter);
        assert_eq!(s.bound.binding_kind(copy.variable), BindingKind::Var);
    });
    analyzed(
        "a.cjs",
        "function f(p, q = () => p) { function p() {} }",
        |s| {
            assert_eq!(
                declared_kind(s, Decl::Param(s.pat("p", 0))),
                BindingKind::Parameter
            );
            assert_eq!(function_kind(s, "p"), BindingKind::Var);
        },
    );
}

#[test]
fn classes() {
    analyzed("a.cjs", "class C {}", |s| {
        let class = s.class("C");
        assert_eq!(declared_kind(s, Decl::Class(class)), BindingKind::Class);
        let inner = s.bound.inner_class_symbol(class);
        assert_eq!(s.bound.binding_kind(inner), BindingKind::ClassInnerName);
    });
    analyzed("a.cjs", "(class C {});", |s| {
        let inner = s.bound.inner_class_symbol(s.class("C"));
        assert_eq!(s.bound.binding_kind(inner), BindingKind::ClassInnerName);
    });
    analyzed("a.cjs", "(class {});", |s| {
        assert_eq!(
            declared_kind(s, Decl::Class(ClassId(0))),
            BindingKind::NoBinding
        );
    });
    analyzed("a.ts", "declare class C {}", |s| {
        assert_eq!(
            declared_kind(s, Decl::Class(s.class("C"))),
            BindingKind::NoBinding
        );
    });
}

#[test]
fn enums_and_namespaces() {
    analyzed("a.ts", "enum E { A }", |s| {
        assert_eq!(
            declared_kind(s, Decl::Enum(EnumId(0))),
            BindingKind::TypeScriptContainer
        );
        assert_eq!(
            declared_kind(s, Decl::EnumMember(EnumMemberId(0))),
            BindingKind::Const
        );
    });
    analyzed("a.ts", "declare enum E { A }", |s| {
        assert_eq!(
            declared_kind(s, Decl::Enum(EnumId(0))),
            BindingKind::NoBinding
        );
        assert_eq!(
            declared_kind(s, Decl::EnumMember(EnumMemberId(0))),
            BindingKind::NoBinding
        );
    });
    analyzed("a.ts", "namespace N { export const a = 1; }", |s| {
        assert_eq!(
            declared_kind(s, Decl::Module(ModuleId(0))),
            BindingKind::TypeScriptContainer
        );
    });
    analyzed("a.ts", "namespace N { export type T = 1; }", |s| {
        assert_eq!(
            declared_kind(s, Decl::Module(ModuleId(0))),
            BindingKind::NoBinding
        );
    });
}

#[test]
fn imports() {
    for &(path, text, decl, kind) in IMPORTS {
        analyzed(path, text, |s| {
            assert_eq!(declared_kind(s, decl), kind, "{text}")
        });
    }
}

#[test]
fn replaced_import_takes_local_kind() {
    analyzed(
        "a.ts",
        r#"import { A } from "m"; export const A = 1;"#,
        |s| {
            assert_eq!(s.bound.binding_kind(s.variable("A", 0)), BindingKind::Const);
        },
    );
    analyzed(
        "a.ts",
        r#"import type { A } from "m"; function A() {}"#,
        |s| {
            assert_eq!(function_kind(s, "A"), BindingKind::Function);
        },
    );
}

#[test]
fn export_expressions() {
    analyzed("a.mjs", "export default 1;", |s| {
        let statements = find_stmts(&s.hir, |kind| matches!(kind, StmtKind::ExportDefault(_)));
        assert_eq!(
            declared_kind(s, Decl::ExportExpr(statements[0])),
            BindingKind::Let
        );
    });
    analyzed("a.ts", "export = 1;", |s| {
        let statements = find_stmts(&s.hir, |kind| matches!(kind, StmtKind::ExportAssign(_)));
        assert_eq!(
            declared_kind(s, Decl::ExportExpr(statements[0])),
            BindingKind::NoBinding
        );
    });
}

#[test]
fn export_local_symbol_has_no_kind() {
    analyzed("a.mjs", "export const v = 1;", |s| {
        let member = s.variable("v", 0);
        let local = s
            .bound
            .lookup(s.bound.scopes[0].locals, s.workspace.atom("v"))
            .unwrap();
        assert_ne!(local, member);
        assert_eq!(s.bound.binding_kind(member), BindingKind::Const);
        assert_eq!(s.bound.binding_kind(local), BindingKind::NoBinding);
    });
}

#[test]
fn merged_declarations_take_highest_kind() {
    analyzed(
        "a.ts",
        "function f() {} namespace f { export const a = 1; }",
        |s| {
            assert_eq!(function_kind(s, "f"), BindingKind::Function);
            assert_eq!(
                declared_kind(s, Decl::Module(ModuleId(0))),
                BindingKind::Function
            );
        },
    );
    analyzed(
        "a.ts",
        "class C {} namespace C { export const a = 1; }",
        |s| {
            assert_eq!(
                declared_kind(s, Decl::Module(ModuleId(0))),
                BindingKind::Class
            );
        },
    );
}

#[test]
fn rejected_declaration_has_no_kind() {
    analyzed("a.cjs", "var f; function f() {}", |s| {
        let binding = s.variable("f", 0);
        assert_eq!(binding, s.bound.declared_symbol(Decl::Fn(s.function("f"))));
        assert_eq!(s.bound.binding_kind(binding), BindingKind::Function);
        let rejected = s.bound.pat_symbol[s.pat("f", 0).idx()];
        assert_ne!(rejected, binding);
        assert_eq!(s.bound.binding_kind(rejected), BindingKind::NoBinding);
    });
}

#[test]
fn symbol_past_end_has_no_kind() {
    analyzed("a.cjs", "var v;", |s| {
        let end = SymbolId(s.bound.symbols.len() as u32);
        assert_eq!(s.bound.binding_kind(end), BindingKind::NoBinding);
        assert_eq!(s.bound.binding_kind(SymbolId::NONE), BindingKind::NoBinding);
    });
}
