mod support;
use support::*;

use ModuleFormat::{CommonJs, Esm};

const FORMATS: &[(&str, &str, ModuleFormat)] = &[
    ("a.js", r#"export {};"#, Esm),
    ("a.js", r#"export const a = 1; module.exports = 2;"#, Esm),
    ("a.js", r#"await 0; module.exports = 1;"#, Esm),
    ("a.js", r#"if (false) await 0; module.exports = 1;"#, Esm),
    ("a.ts", r#"export type A = 1; module.exports = 1;"#, Esm),
    ("a.cjs", r#"export {};"#, Esm),
    ("a.js", r#"if (false) module.exports = 1;"#, Esm),
    ("a.js", r#"if (false) exports.a = 1;"#, Esm),
    ("a.js", r#"function f(module) { module; }"#, Esm),
    ("a.js", r#"function f() { return; }"#, Esm),
    ("a.js", r#"if (false) return;"#, Esm),
    ("a.js", r#"return;"#, Esm),
    ("a.js", r#"module.exports = 1;"#, CommonJs),
    ("a.ts", r#"class A { @(this) b() {} }"#, CommonJs),
    ("a.ts", r#"class A { b(@(this) c) {} }"#, Esm),
    ("a.js", r#"exports.a = 1;"#, CommonJs),
    ("a.js", r#"typeof module;"#, CommonJs),
    ("a.js", r#"with (a) b;"#, CommonJs),
    ("a.js", r#"function f() { with (a) b; }"#, CommonJs),
    ("a.js", r#"if (false) { with (a) b; }"#, CommonJs),
    ("a.mjs", r#"module.exports = 1;"#, CommonJs),
    ("a.cjs", r#"import "m";"#, Esm),
    ("a.cjs", r#"import.meta;"#, Esm),
    ("a.cts", r#"import type {} from "a";"#, Esm),
    ("a.cts", r#"import { T } from "m";"#, Esm),
    ("a.cjs", r#""#, CommonJs),
    ("a.cjs", r#"1;"#, CommonJs),
    ("a.cjs", r#"import("m");"#, CommonJs),
    ("a.cjs", r#"/** @import { T } from "m" */"#, CommonJs),
    ("a.cjs", r#"/** @import { T } from "m" */ T = 1;"#, CommonJs),
    ("a.mjs", r#""#, Esm),
    ("a.mjs", r#"require("m");"#, Esm),
    ("a.mjs", r#""use strict";"#, Esm),
    ("a.mjs", r#"module.require("a");"#, Esm),
    ("a.js", r#"import "m";"#, Esm),
    ("a.js", r#"import { a } from "m"; require("x");"#, Esm),
    ("a.ts", r#"import { T } from "m"; require("x");"#, Esm),
    ("a.js", r#""#, Esm),
    ("a.js", r#"1;"#, Esm),
    ("a.js", r#"("use strict");"#, Esm),
    ("a.js", r#"function f() { "use strict"; }"#, Esm),
    ("a.js", r#"if (false) require("a");"#, Esm),
    ("a.js", r#"function f(require) { require("a"); }"#, Esm),
    ("a.js", r#"module.require("a");"#, Esm),
    ("a.js", r#"require("a");"#, CommonJs),
    ("a.js", r#"__dirname;"#, CommonJs),
    ("a.js", r#"__filename;"#, CommonJs),
    ("a.js", r#""use strict";"#, CommonJs),
    ("a.js", r#"'use strict'; 1;"#, CommonJs),
    (
        "a.ts",
        r#"import type { A } from "m"; require("x");"#,
        CommonJs,
    ),
    (
        "a.ts",
        r#"import { type A } from "m"; require("x");"#,
        CommonJs,
    ),
    ("a.ts", r#"import r = require("m"); r;"#, CommonJs),
    ("a.ts", r#"import r = require("m");"#, CommonJs),
    (
        "a.ts",
        r#"import { feature } from "bun:bundle"; require("a");"#,
        CommonJs,
    ),
    (
        "a.js",
        r#"import { run } from "./run"; if (require.main === module) run();"#,
        Esm,
    ),
    ("a.mjs", r#"require.main === module;"#, Esm),
    ("a.mjs", r#"module != require.main;"#, Esm),
    ("a.js", r#"require.main === module;"#, CommonJs),
    ("a.mjs", r#"require.main === module.parent;"#, CommonJs),
    ("a.mjs", r#"other === module;"#, CommonJs),
    (
        "a.js",
        r#"var exports = exports || {}; exports.x = 1;"#,
        CommonJs,
    ),
    ("a.mjs", r#"var module = module || {};"#, CommonJs),
    ("a.js", r#"var exports = 1;"#, Esm),
    ("a.js", r#"let exports = {}; exports.x = 1;"#, Esm),
    (
        "a.js",
        r#"import "m"; var exports = {}; exports.x = 1;"#,
        Esm,
    ),
    ("a.js", r#"var require = 1; require;"#, Esm),
];

const COMMONJS_EVIDENCE: &[(&str, CommonJsEvidence)] = &[
    ("module.exports = 1;", CommonJsEvidence::MODULE),
    ("exports.a = 1;", CommonJsEvidence::EXPORTS),
    ("with (a) b;", CommonJsEvidence::WITH_STATEMENT),
    (
        "module.exports = exports;",
        CommonJsEvidence::MODULE.union(CommonJsEvidence::EXPORTS),
    ),
];

const NO_FORMAT_ERROR: &[(&str, &str)] = &[
    ("a.ts", r#"import { T } from "m"; module.exports = 1;"#),
    (
        "a.ts",
        r#"import { run } from "./run"; if (require.main === module) run();"#,
    ),
    ("a.ts", r#"import { type A } from "m"; module.exports = 1;"#),
    ("a.js", r#"import a from "m"; a; return;"#),
    (
        "a.js",
        r#"import a from "m"; export default a; module.exports = 1;"#,
    ),
    (
        "a.ts",
        r#"import { m } from "./m" with { type: "macro" }; module.exports = 1;"#,
    ),
];

const UNUSED_IMPORTS: &[(&str, &str, &[&str], usize)] = &[
    (
        "a.ts",
        r#"import d, { a, b as c } from "m"; import * as n from "n"; a;"#,
        &["d", "c", "n"],
        1,
    ),
    (
        "a.ts",
        r#"import { A } from "m"; let x: A; type T = typeof A;"#,
        &["A"],
        0,
    ),
    ("a.ts", r#"import { A } from "m"; if (false) A;"#, &["A"], 1),
    ("a.ts", r#"import { A } from "m"; export { A };"#, &[], 1),
    ("a.mjs", r#"import { a } from "m";"#, &[], 1),
    (
        "a.ts",
        r#"import * as n from "m"; import a = n.b; a;"#,
        &[],
        1,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; import a = n.b;"#,
        &["n", "a"],
        1,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; import a = n.b; if (false) a;"#,
        &["n", "a"],
        1,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; import type a = n.b;"#,
        &["n"],
        0,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; import a = n.b; import c = a.d; c;"#,
        &[],
        1,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; import c = a.d; import a = n.b; c;"#,
        &[],
        1,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; export import a = n.b;"#,
        &[],
        1,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; namespace N { import a = n.b; export const c = 1; }"#,
        &[],
        1,
    ),
    (
        "a.ts",
        r#"import * as n from "m"; namespace N { import a = n.b; }"#,
        &["n", "a"],
        0,
    ),
    (
        "a.ts",
        r#"import r = require("m"); import a = r.b; a;"#,
        &[],
        1,
    ),
    ("a.ts", r#"import r = require("m");"#, &["r"], 1),
];

const TYPESCRIPT_SITE_COUNTS: &[(&str, usize)] = &[
    (r#"import "m";"#, 1),
    (r#"import {} from "m";"#, 1),
    (r#"import { type A, b } from "m"; b;"#, 1),
    (r#"import r = require("m"); r;"#, 1),
    (r#"import r = require("m");"#, 1),
    (r#"export import r = require("m");"#, 1),
    (r#"export { type A, b } from "m";"#, 1),
    (r#"import { type A } from "m";"#, 0),
    (r#"import type { A } from "m";"#, 0),
    (r#"import type D from "m";"#, 0),
    (r#"import type r = require("m");"#, 0),
    (r#"export { type A } from "m";"#, 0),
    (r#"export type { A } from "m";"#, 0),
    (r#"export type * from "m";"#, 0),
];

const KINDS_AND_ORDER: &str = r#"import("c1"); import a from "s1"; export { b } from "s2"; export * from "s3"; import e = require("s4"); a; e; require("c2"); require.resolve("c3"); module.require("c4"); import.meta.require("c5"); import.meta.resolve("c6"); process.getBuiltinModule("c7"); import(x);"#;

const NOT_SITES: &[&str] = &[
    r#"function f(require) { require("a"); }"#,
    r#"const require = f; require("a");"#,
    r#"with (o) require("a");"#,
    r#"let r = require; r = f; r("a");"#,
    r#"const r = require; f(r);"#,
    r#"new require("a");"#,
    r#"require();"#,
    r#"x.require("a");"#,
    r#"function f(module) { module.require("a"); }"#,
    r#"with (o) { (function () { eval(s); require("a"); }); }"#,
];

const DEAD_SITES: &[&str] = &[
    r#"if (false) { require("a"); import("b"); }"#,
    r#"false && require("a");"#,
    r#"true ? 0 : require("a");"#,
];

const ONE_SITE: &[(&str, &str)] = &[
    ("a.ts", r#"require("a");"#),
    ("a.cjs", r#"require?.("a");"#),
    ("a.cjs", r#"const r = require; r("a");"#),
    ("a.ts", r#"(require as any)("a");"#),
    ("a.ts", r#"(module as any).require!("a");"#),
    ("a.cjs", r#"eval(s); require("a");"#),
    ("a.cjs", r#"function f() { eval(s); require("a"); }"#),
    (
        "a.cjs",
        r#"function f() { eval(s); require.resolve("a"); }"#,
    ),
    ("a.cjs", r#"function f() { eval(s); module.require("a"); }"#),
];

const CONSTANT_SPECIFIERS: &[&str] = &[
    r#"require("a" + "b");"#,
    r#"require("a" + "" + "b");"#,
    r#"require.resolve("a" + "b");"#,
    r#"import(`a${"b"}`);"#,
    r#"const p = "a"; require(p + "b");"#,
    r#"const p = "a"; function name() { return p; } require(p + "b");"#,
    r#"const p = "ab"; function load() { return require(p); }"#,
    r#"switch (x) { case 0: const p = "ab"; break; default: require(p); }"#,
    r#"require((f(), "ab"));"#,
    r#"require(void f() || "ab");"#,
];

const UNRECORDED_SPECIFIERS: &[&str] = &[
    r#"require("ab");"#,
    "require(x);",
    r#"g("a" + "b");"#,
    r#"function h(require) { require("a" + "b"); }"#,
];

const JSON_ATTRIBUTES: &[&str] = &[
    r#"import j from "j" with { type: "json" }; j;"#,
    r#"export * from "j" with { type: "json" };"#,
    r#"import("j", { with: { type: "json" } });"#,
    r#"import.meta.require("j", { type: "json" });"#,
    r#"require("j", { type: "json" });"#,
];

const NO_ATTRIBUTES: &[&str] = &[
    r#"import("j");"#,
    r#"import("j", options);"#,
    r#"require("j");"#,
    r#"require("j", options);"#,
];

const MACRO_CALL_FORMS: &[(&str, &str, usize)] = &[
    ("* as m", "m.f();", 1),
    ("* as m", r#"m["f"]();"#, 1),
    ("* as m", "m[k]();", 0),
    ("* as m", "x.m();", 0),
    ("* as m", "m();", 0),
    ("d, { f }", "d();", 1),
    ("d, { f }", "f();", 1),
    ("d, { f }", "d.get();", 0),
    ("d, { f }", "f.call(null);", 0),
    ("{ type f }", "f();", 0),
    ("type { f }", "f();", 0),
];

const BLOCK_FUNCTION: &str = "{ function f() {} } f;";
const BLOCK_FUNCTION_MODULE: &str = "{ function module() {} } module.exports = 1;";
const VAR_AND_FUNCTION: &str = "var f; function f() {}";

const REPEATED_ANALYSES: &[(&str, &str)] = &[
    ("a.mts", KINDS_AND_ORDER),
    ("a.js", BLOCK_FUNCTION),
    ("a.cjs", BLOCK_FUNCTION),
    ("a.js", BLOCK_FUNCTION_MODULE),
    ("a.js", VAR_AND_FUNCTION),
    ("a.cjs", VAR_AND_FUNCTION),
];

const MACRO_FORMAT: &str = r#"import { flag } from "./m" with { type: "macro" }; function g() {} if (flag()) require("a");"#;

const TOP_LEVEL_AWAITS: &[(&str, bool, bool)] = &[
    ("await 0;", true, true),
    ("for await (const x of y);", true, true),
    ("await using a = b;", true, true),
    ("class A { [await 0]() {} }", true, true),
    ("if (false) await 0;", true, false),
    ("false && (await 0);", true, false),
    ("async function f() { await 0; }", false, false),
    ("const f = async () => { await 0; };", false, false),
    ("1;", false, false),
];

const MAIN_MODULE_COMPARISONS: &[(&str, bool)] = &[
    ("require.main === module;", true),
    ("require.main == module;", true),
    ("module === require.main;", true),
    ("require.main !== module;", false),
    ("module != require.main;", false),
];

const OTHER_MODULE_COMPARISONS: &[&str] = &[
    "require.main === module.parent;",
    "other === module;",
    "require.main < module;",
    "function f(module) { require.main === module; }",
    "function f(require) { require.main === module; }",
];

fn sites(s: &Analyzed<'_>) -> Vec<(ImportSiteKind, String)> {
    let specifier_text = |site: &ImportSite| match site.specifier {
        ImportSpecifier::Constant(text) => s.workspace.text(text).to_owned(),
        ImportSpecifier::Pattern { prefix, suffix } => {
            format!("{}*{}", s.workspace.text(prefix), s.workspace.text(suffix))
        }
        ImportSpecifier::Unknown => "<unknown>".to_owned(),
    };
    s.analysis
        .import_sites
        .iter()
        .map(|site| (site.kind, specifier_text(site)))
        .collect()
}

fn unused<'a>(s: &'a Analyzed<'_>) -> Vec<&'a str> {
    s.analysis
        .unused_import_symbols
        .iter()
        .map(|&symbol| s.workspace.text(s.bound.symbol(symbol).name))
        .collect()
}

fn site_count(path: &str, text: &str) -> usize {
    let mut count = 0;
    analyzed(path, text, |s| count = s.analysis.import_sites.len());
    count
}

fn site_kind_name(kind: ImportSiteKind) -> &'static str {
    match kind {
        ImportSiteKind::JsxRuntime => "JsxRuntime",
        ImportSiteKind::JsxPackage => "JsxPackage",
        ImportSiteKind::Import(_) => "Import",
        ImportSiteKind::ExportFrom(_) => "ExportFrom",
        ImportSiteKind::ExportStar(_) => "ExportStar",
        ImportSiteKind::ImportEquals(_) => "ImportEquals",
        ImportSiteKind::ImportCall(_) => "ImportCall",
        ImportSiteKind::Require(_) => "Require",
        ImportSiteKind::RequireResolve(_) => "RequireResolve",
        ImportSiteKind::ImportMetaRequire(_) => "ImportMetaRequire",
        ImportSiteKind::ImportMetaResolve(_) => "ImportMetaResolve",
        ImportSiteKind::GetBuiltinModule(_) => "GetBuiltinModule",
    }
}

fn site_call(kind: ImportSiteKind) -> Option<ExprId> {
    match kind {
        ImportSiteKind::ImportCall(call)
        | ImportSiteKind::Require(call)
        | ImportSiteKind::RequireResolve(call)
        | ImportSiteKind::ImportMetaRequire(call)
        | ImportSiteKind::ImportMetaResolve(call)
        | ImportSiteKind::GetBuiltinModule(call) => Some(call),
        _ => None,
    }
}

#[track_caller]
fn only_site(s: &Analyzed<'_>, row: &str) -> ImportSite {
    let [site] = s.analysis.import_sites else {
        panic!("{row}: {:?}", s.analysis.import_sites);
    };
    *site
}

#[track_caller]
fn call_of<'s>(w: &Workspace<'s>, hir: &File<'s>, name: &str) -> ExprId {
    let callee = w.ident(hir, name, 0);
    let calls = find_exprs(
        hir,
        |kind| matches!(*kind, ExprKind::Call(call) if hir[call].callee == callee),
    );
    assert_eq!(calls.len(), 1, "calls of {name}");
    calls[0]
}

#[track_caller]
fn last_call_argument(s: &Analyzed<'_>) -> ExprId {
    let calls = find_exprs(&s.hir, |kind| {
        matches!(kind, ExprKind::Call(_) | ExprKind::ImportCall { .. })
    });
    let args = match s.hir[calls[calls.len() - 1]].kind {
        ExprKind::Call(call) => s.hir[call].args,
        ExprKind::ImportCall { args } => args,
        kind => panic!("{kind:?} is no call"),
    };
    s.hir.id_at(args, 0)
}

fn strict_flags(hir: &File<'_>) -> Vec<bool> {
    hir.fns.iter().map(|function| function.is_strict).collect()
}

fn analyzed_with_main(
    path: &str,
    text: &str,
    import_meta_main: Option<bool>,
    test: impl for<'s> FnOnce(&Analyzed<'s>) + Send,
) {
    let source = Source {
        import_meta_main,
        ..Source::new(path, text)
    };
    analyzed_source(&source, test);
}

#[track_caller]
fn comparison_decision<'s>(s: &Analyzed<'s>) -> Decision<'s> {
    let comparisons = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Binary { .. }));
    let [comparison] = comparisons[..] else {
        panic!("comparisons: {comparisons:?}");
    };
    s.analysis.decisions.decision(comparison)
}

fn check_main_module_comparison(text: &str, main: Option<bool>, expected: Decision<'static>) {
    for (path, format) in [("a.js", CommonJs), ("a.mjs", Esm)] {
        analyzed_with_main(path, text, main, |s| {
            assert_eq!(comparison_decision(s), expected, "{path}: {text}: {main:?}");
            assert_eq!(s.analysis.module_format, format, "{path}: {text}: {main:?}");
        });
    }
}

#[test]
fn positions_of_this_answer_as_the_walk_does() {
    use bun_sema::module_format::{ThisPositions, evaluates_own_this};
    let text = r#"
        function plain(a = 1) { return a; }
        function own() { return this; }
        function empty(a = this) {}
        function in_default(a = () => this) { return a; }
        function in_arrow() { return () => this; }
        function in_computed_name() { return { [this.a]() {} }; }
        function in_computed_field() { return class { [this.a] = 1; }; }
        function in_heritage() { return class extends this.a {}; }
        function in_member_decorator() { return class { @(this.a) b() {} }; }
        function in_parameter_decorator() { return class { b(@(this.a) c) {} }; }
        function in_constructor_parameter_decorator() { return class { constructor(@(this.a) c) {} }; }
        function of_default_behind_decorator() { return class { b(@a c = this) {} }; }
        function of_inner_function() { return function () { return this; }; }
        function of_method() { return { a() { return this; } }; }
        function of_field() { return class { a = this; }; }
        function behind_the_others() { return 1; }
        this;
    "#;
    analyzed("a.js", text, |s| {
        let positions = ThisPositions::of(&s.hir);
        let names_of = |test: &dyn Fn(FnId) -> bool| -> Vec<String> {
            let functions = (0..s.hir.fns.len() as u32).map(FnId).filter(|&it| test(it));
            let declared = functions.filter(|&it| s.hir[it].kind == FnKind::Decl);
            declared
                .map(|it| s.workspace.text(s.hir[it].name).to_owned())
                .collect()
        };
        for function in (0..s.hir.fns.len() as u32).map(FnId) {
            let by_walk = evaluates_own_this(&s.hir, function);
            assert_eq!(
                positions.evaluates_own_this(&s.hir, function),
                by_walk,
                "{function:?}"
            );
        }
        let by_positions = names_of(&|it| positions.evaluates_own_this(&s.hir, it));
        let expected = [
            "own",
            "empty",
            "in_default",
            "in_arrow",
            "in_computed_name",
            "in_computed_field",
            "in_heritage",
            "in_member_decorator",
            "in_parameter_decorator",
            "in_constructor_parameter_decorator",
        ];
        assert_eq!(by_positions, expected);
    });
}

#[test]
fn formats() {
    for &(path, text, format) in FORMATS {
        analyzed(path, text, |s| {
            assert_eq!(s.analysis.module_format, format, "{path}: {text}");
        });
    }
}

#[test]
fn main_module_comparisons() {
    for &(text, is_equality) in MAIN_MODULE_COMPARISONS {
        check_main_module_comparison(text, None, Decision::Unknown);
        for is_main in [true, false] {
            let expected = Decision::Constant(Constant::Boolean(is_main == is_equality));
            check_main_module_comparison(text, Some(is_main), expected);
        }
    }
    for &text in OTHER_MODULE_COMPARISONS {
        analyzed_with_main("a.cjs", text, Some(true), |s| {
            assert_eq!(comparison_decision(s), Decision::Unknown, "{text}");
        });
    }
    let guarded_call = "export function main() {} if (require.main === module) main();";
    for is_main in [true, false] {
        analyzed_with_main("a.js", guarded_call, Some(is_main), |s| {
            let call = call_of(&s.workspace, &s.hir, "main");
            assert_eq!(s.analysis.decisions.is_dead_expr(call), !is_main);
        });
    }
}

#[test]
fn module_require_is_site_without_evidence() {
    for path in ["a.js", "a.mjs"] {
        assert_eq!(site_count(path, r#"module.require("a");"#), 1, "{path}");
    }
}

#[test]
fn export_assign_is_commonjs() {
    analyzed("a.ts", "export = 1;", |s| {
        assert_eq!(s.analysis.module_format, CommonJs);
    });
}

#[test]
fn import_statement_in_commonjs() {
    for &(suffix, evidence) in COMMONJS_EVIDENCE {
        let text = format!(r#"import a from "m"; a; {suffix}"#);
        analyzed("a.js", &text, |s| {
            let imports = find_stmts(&s.hir, |kind| matches!(kind, StmtKind::Import(_)));
            let expected = FoldError {
                kind: FoldErrorKind::ImportStatementInCommonJs(evidence),
                node: NodeData::Stmt(imports[0]),
            };
            assert_eq!(s.analysis.module_format, CommonJs, "{text}");
            assert_eq!(s.analysis.errors, [expected], "{text}");
        });
    }
}

#[test]
fn import_statement_without_format_error() {
    for &(path, text) in NO_FORMAT_ERROR {
        analyzed(path, text, |s| {
            assert!(s.analysis.errors.is_empty(), "{path}: {text}");
        });
    }
}

#[test]
fn unused_imports() {
    for &(path, text, names, count) in UNUSED_IMPORTS {
        analyzed(path, text, |s| {
            assert_eq!(unused(s), names, "{path}: {text}");
            assert_eq!(s.analysis.import_sites.len(), count, "{path}: {text}");
        });
    }
}

#[test]
fn typescript_import_site_counts() {
    for &(text, count) in TYPESCRIPT_SITE_COUNTS {
        assert_eq!(site_count("a.ts", text), count, "{text}");
    }
}

#[test]
fn preserved_unused_import_is_site() {
    with_workspace(|w| {
        let fold = w.fold_inputs(&Fold {
            preserves_unused_imports: true,
            ..Fold::NONE
        });
        let s = w.analyze(&Source::new("a.ts", r#"import { A } from "m";"#), &fold);
        assert_eq!(s.analysis.import_sites.len(), 1);
    });
}

#[test]
fn kinds_and_order() {
    analyzed("a.mts", KINDS_AND_ORDER, |s| {
        let found = sites(s);
        let names: Vec<(&str, &str)> = found
            .iter()
            .map(|(kind, text)| (site_kind_name(*kind), text.as_str()))
            .collect();
        let expected = [
            ("Import", "s1"),
            ("ExportFrom", "s2"),
            ("ExportStar", "s3"),
            ("ImportEquals", "s4"),
            ("ImportCall", "c1"),
            ("Require", "c2"),
            ("RequireResolve", "c3"),
            ("Require", "c4"),
            ("ImportMetaRequire", "c5"),
            ("ImportMetaResolve", "c6"),
            ("GetBuiltinModule", "c7"),
            ("ImportCall", "<unknown>"),
        ];
        assert_eq!(names, expected);
        let calls: Vec<ExprId> = found.iter().filter_map(|site| site_call(site.0)).collect();
        assert_eq!(calls.len(), 8);
        assert!(calls.is_sorted(), "{calls:?}");
        for (index, &(kind, _)) in found.iter().enumerate() {
            assert_eq!(s.analysis.import_site_index(kind), Some(index), "{kind:?}");
            if let Some(call) = site_call(kind) {
                assert_eq!(
                    s.analysis.import_site_of_call(call),
                    Some(index),
                    "{kind:?}"
                );
            }
        }
    });
}

#[test]
fn lookups_of_other_calls_find_nothing() {
    for text in [r#"require("a"); f();"#, "f();"] {
        analyzed("a.cjs", text, |s| {
            let call = call_of(&s.workspace, &s.hir, "f");
            let kind = ImportSiteKind::Require(call);
            assert_eq!(s.analysis.import_site_of_call(call), None, "{text}");
            assert_eq!(s.analysis.import_site_index(kind), None, "{text}");
        });
    }
}

#[test]
fn sites_are_found_by_binding() {
    for text in NOT_SITES {
        assert_eq!(site_count("a.cjs", text), 0, "{text}");
    }
    for &(path, text) in ONE_SITE {
        assert_eq!(site_count(path, text), 1, "{path}: {text}");
    }
}

#[test]
fn dead_code_has_no_site() {
    for text in DEAD_SITES {
        assert_eq!(site_count("a.cjs", text), 0, "{text}");
    }
}

#[test]
fn specifiers() {
    analyzed("a.cjs", "require(x);", |s| {
        assert_eq!(
            only_site(s, "require(x)").specifier,
            ImportSpecifier::Unknown
        );
    });
    analyzed("a.cjs", r#"require("./" + x + ".js");"#, |s| {
        let expected = ImportSpecifier::Pattern {
            prefix: s.workspace.atom("./"),
            suffix: s.workspace.atom(".js"),
        };
        assert_eq!(only_site(s, "require").specifier, expected);
    });
    for &text in CONSTANT_SPECIFIERS {
        analyzed("a.cjs", text, |s| {
            let expected = ImportSpecifier::Constant(s.workspace.atom("ab"));
            assert_eq!(only_site(s, text).specifier, expected, "{text}");
        });
    }
}

#[test]
fn own_directory_at_the_head_of_a_specifier_is_the_folder_of_the_file() {
    const CONSTANTS: &[(&str, &str, &str)] = &[
        (
            "a.cjs",
            r#"require(__dirname + "/lib/a.js");"#,
            "./lib/a.js",
        ),
        (
            "a.cjs",
            r#"require(__dirname + "/lib" + "/a" + ".js");"#,
            "./lib/a.js",
        ),
        ("a.cjs", "require(`${__dirname}/lib/a.js`);", "./lib/a.js"),
        (
            "a.cjs",
            r#"require.resolve(__dirname + "/lib/a.js");"#,
            "./lib/a.js",
        ),
        ("a.cjs", r#"require(__dirname + "/../a.js");"#, "./../a.js"),
        ("a.cjs", "require(__dirname);", "."),
        (
            "a.cjs",
            r#"function f() { return require(__dirname + "/a.js"); }"#,
            "./a.js",
        ),
        ("a.mjs", r#"import(__dirname + "/lib/a.js");"#, "./lib/a.js"),
        (
            "a.mjs",
            r#"import(import.meta.dir + "/lib/a.js");"#,
            "./lib/a.js",
        ),
        (
            "a.mjs",
            "import(`${import.meta.dirname}/lib/a.js`);",
            "./lib/a.js",
        ),
    ];
    for &(path, text, specifier) in CONSTANTS {
        analyzed(path, text, |s| {
            let expected = ImportSpecifier::Constant(s.workspace.atom(specifier));
            assert_eq!(only_site(s, text).specifier, expected, "{text}");
        });
    }
    analyzed(
        "a.cjs",
        r#"require(__dirname + "/lib/" + x + ".js");"#,
        |s| {
            let expected = ImportSpecifier::Pattern {
                prefix: s.workspace.atom("./lib/"),
                suffix: s.workspace.atom(".js"),
            };
            assert_eq!(only_site(s, "require").specifier, expected);
        },
    );
    analyzed("a.cjs", r#"require(__dirname + "2/a.js");"#, |s| {
        let expected = ImportSpecifier::Pattern {
            prefix: s.workspace.atom(""),
            suffix: s.workspace.atom("2/a.js"),
        };
        assert_eq!(only_site(s, "require").specifier, expected);
    });
    const UNKNOWN: &[&str] = &[
        "require(__dirname + x);",
        "function f(__dirname) { return require(__dirname + x); }",
        "function f(o) { with (o) { return import(__dirname + x); } }",
        r#"function f(text) { eval(text); return import(__dirname + x); }"#,
    ];
    for &text in UNKNOWN {
        analyzed("a.cjs", text, |s| {
            assert_eq!(
                only_site(s, text).specifier,
                ImportSpecifier::Unknown,
                "{text}"
            );
        });
    }
    const NOT_AT_THE_HEAD: &[&str] = &[
        r#"require("./a" + __dirname + "/b.js");"#,
        r#"function f(__dirname) { return require(__dirname + "/b.js"); }"#,
        r#"function f(o) { with (o) { return import(__dirname + "/b.js"); } }"#,
        r#"require((x ? __dirname + "/a" : __dirname + "/c") + "/b.js");"#,
        r#"__dirname = x; require(__dirname + "/b.js");"#,
        r#"__dirname += "/other"; require(__dirname + "/b.js");"#,
        r#"function f() { __dirname = x; } require(__dirname + "/b.js");"#,
        r#"eval(x); import(__dirname + "/b.js");"#,
        r#"arguments[4] = x; import(__dirname + "/b.js");"#,
    ];
    for &text in NOT_AT_THE_HEAD {
        analyzed("a.cjs", text, |s| {
            let ImportSpecifier::Pattern { prefix, suffix } = only_site(s, text).specifier else {
                panic!("{text}: {:?}", only_site(s, text).specifier);
            };
            assert!(!s.workspace.text(prefix).starts_with("./a."), "{text}");
            assert!(!s.workspace.text(prefix).starts_with("./b"), "{text}");
            assert_eq!(s.workspace.text(suffix), "/b.js", "{text}");
        });
    }
}

#[test]
fn specifier_argument_is_still_evaluated() {
    for &text in CONSTANT_SPECIFIERS {
        analyzed("a.cjs", text, |s| {
            let decisions = &s.analysis.decisions;
            let value = decisions.specifier(last_call_argument(s));
            let expected = ImportSpecifier::Constant(s.workspace.atom("ab"));
            assert_eq!(value, expected, "{text}");
            for e in find_exprs(&s.hir, |_| true) {
                assert_eq!(decisions.decision(e), Decision::Unknown, "{e:?}: {text}");
                assert!(!decisions.is_dead_expr(e), "{e:?}: {text}");
            }
        });
    }
    for &text in UNRECORDED_SPECIFIERS {
        analyzed("a.cjs", text, |s| {
            let value = s.analysis.decisions.specifier(last_call_argument(s));
            assert_eq!(value, ImportSpecifier::Unknown, "{text}");
        });
    }
}

#[test]
fn attributes() {
    for &text in JSON_ATTRIBUTES {
        analyzed("a.mjs", text, |s| {
            let attributes = only_site(s, text).attributes;
            let value = s.hir.import_attribute(attributes, known::r#type);
            assert_eq!(value, Some(s.workspace.atom("json")), "{text}");
        });
    }
    for &text in NO_ATTRIBUTES {
        analyzed("a.mjs", text, |s| {
            assert_eq!(only_site(s, text).attributes, ExprId::NONE, "{text}");
        });
    }
}

#[test]
fn macro_call_forms() {
    for &(clause, call, pending_count) in MACRO_CALL_FORMS {
        let text = format!(r#"import {clause} from "./m" with {{ type: "macro" }}; {call}"#);
        analyzed("a.ts", &text, |s| {
            assert_eq!(
                s.analysis.pending_macro_calls.len(),
                pending_count,
                "{text}"
            );
        });
    }
}

#[test]
fn default_module_becomes_strict() {
    analyzed("a.js", BLOCK_FUNCTION, |s| {
        let f = s.function("f");
        assert_eq!(s.analysis.module_format, Esm);
        assert!(s.hir.is_strict);
        assert!(!s.hir.is_strict_by_syntax);
        assert!(s.hir[f].is_strict);
        assert!(!s.hir[f].is_strict_by_syntax);
        assert!(s.bound.runtime.annex_b_functions().is_empty());
        assert_eq!(s.binding("f", 0), Binding::Free);
    });
    analyzed("a.cjs", BLOCK_FUNCTION, |s| {
        let f = s.function("f");
        assert_eq!(s.analysis.module_format, CommonJs);
        assert!(!s.hir.is_strict);
        assert!(!s.hir[f].is_strict);
        assert_eq!(s.bound.runtime.annex_b_functions().len(), 1);
    });
}

#[test]
fn first_format_stands() {
    analyzed("a.js", BLOCK_FUNCTION_MODULE, |s| {
        let expected = Binding::CommonJs(CommonJsVariable::Module);
        assert_eq!(s.analysis.module_format, Esm);
        assert_eq!(s.binding("module", 0), expected);
    });
}

#[test]
fn early_errors_follow_goal() {
    analyzed("a.js", VAR_AND_FUNCTION, |s| {
        assert_eq!(s.bound.runtime.early_redeclarations().len(), 1);
    });
    analyzed("a.cjs", VAR_AND_FUNCTION, |s| {
        assert!(s.bound.runtime.early_redeclarations().is_empty());
    });
}

#[test]
fn repeated_analysis_is_identical() {
    for &(path, text) in REPEATED_ANALYSES {
        with_workspace(|w| {
            let source = Source::new(path, text);
            let fold = w.fold_inputs(&Fold::NONE);
            let mut first = w.analyze(&source, &fold);
            let analysis = format!("{:?}", first.analysis);
            let bindings = describe_runtime(&first.bound);
            let strict = strict_flags(&first.hir);
            let (bound, again) = w.analyze_tree(&mut first.hir, &source, &fold, &[]);
            assert_eq!(format!("{again:?}"), analysis, "{path}: {text}");
            assert_eq!(describe_runtime(&bound), bindings, "{path}: {text}");
            assert_eq!(strict_flags(&first.hir), strict, "{path}: {text}");
        });
    }
}

#[test]
fn macro_results_change_format() {
    with_workspace(|w| {
        let source = Source::new("a.ts", MACRO_FORMAT);
        let fold = w.fold_inputs(&Fold::NONE);
        let mut hir = w.parse(&source);

        let (_, first) = w.analyze_tree(&mut hir, &source, &fold, &[]);
        let call = call_of(w, &hir, "flag");
        let g = w.function(&hir, "g");
        assert_eq!(first.pending_macro_calls, [call]);
        assert_eq!(first.module_format, CommonJs);
        assert!(!hir[g].is_strict);
        assert_eq!(first.import_sites.len(), 2);

        let results = [(call, w.host_data(&Data::Boolean(false)))];
        let (_, second) = w.analyze_tree(&mut hir, &source, &fold, &results);
        assert!(second.pending_macro_calls.is_empty());
        assert_eq!(second.module_format, Esm);
        assert!(hir[g].is_strict);
        assert_eq!(second.import_sites.len(), 1);

        let results = [(call, w.host_data(&Data::Boolean(true)))];
        let (_, third) = w.analyze_tree(&mut hir, &source, &fold, &results);
        assert_eq!(third.module_format, CommonJs);
        assert!(!hir[g].is_strict);
    });
}

#[test]
fn top_level_await() {
    for &(text, has_await, is_live) in TOP_LEVEL_AWAITS {
        analyzed("a.mjs", text, |s| {
            assert_eq!(s.hir.has_top_level_await(), has_await, "{text}");
            assert_eq!(s.analysis.has_live_top_level_await, is_live, "{text}");
        });
    }
}
