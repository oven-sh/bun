mod support;
use support::*;

const MACROS: &str =
    r#"import { zero, f, g, h, inner, outer } from "./m" with { type: "macro" }; "#;

const PENDING_MACRO_CALLS: &[(&str, &[&str])] = &[
    ("f(); g();", &["f", "g"]),
    ("zero() + f();", &["zero", "f"]),
    ("if (x) f(); g();", &["f", "g"]),
    ("x ? f() : g(); x && h();", &["f", "g", "h"]),
    ("outer(inner()); g();", &["inner", "outer", "g"]),
    ("const c = zero(); f(c);", &["zero", "f"]),
    (
        "function k() { if (c) f(); } const c = zero();",
        &["f", "zero"],
    ),
    ("if (zero()) f();", &["zero"]),
    ("if (zero()) {} else f();", &["zero"]),
    ("zero() ? f() : g();", &["zero"]),
    ("zero() && f();", &["zero"]),
    ("zero() || f();", &["zero"]),
    ("zero() ?? f();", &["zero"]),
    ("if (!(zero() as number)) f();", &["zero"]),
    ("if (check(zero())) f();", &["zero"]),
    ("if ({ p: zero() }.p) f();", &["zero"]),
    ("if (zero()) { function k() { f(); } }", &["zero"]),
    ("if (zero()) { class K { p = f(); } }", &["zero"]),
    ("outer(zero() ? inner() : 1);", &["zero"]),
    ("f(); if (zero()) g(); h();", &["f", "zero"]),
    ("const c = zero(); g(); if (c) f(); h();", &["zero", "g"]),
    (
        "const c = zero(); function k() { return c && f(); }",
        &["zero"],
    ),
];

const CALL_SITES: &[&str] = &[
    r#"require("a");"#,
    r#"require("a", x);"#,
    r#"require("a" + "b");"#,
    "require(x);",
    "require(...x);",
    r#"require.resolve("a");"#,
    r#"module.require("a");"#,
    r#"import("a");"#,
    r#"import.meta.require("a");"#,
    r#"import.meta.resolve("a");"#,
    r#"process.getBuiltinModule("a");"#,
];

const STATEMENT_SITES: &str =
    r#"import "s1"; export { a } from "s2"; export * from "s3"; import r = require("s4");"#;

const RESOLVER_USES: &[(&str, bool)] = &[
    (r#"import.meta.resolve("a");"#, true),
    (r#"import.meta.resolve("@scope/a");"#, true),
    (r##"import.meta.resolve("#a");"##, true),
    (r#"import.meta.resolve(".a");"#, true),
    (r#"import.meta.resolve("..");"#, true),
    (r#"import.meta.resolve("node");"#, true),
    (r#"import.meta.resolve("file:a");"#, true),
    (r#"import.meta.resolve("./a");"#, false),
    (r#"import.meta.resolve("../a");"#, false),
    (r#"import.meta.resolve("/a");"#, false),
    (r#"import.meta.resolve("file:///a");"#, false),
    (r#"import.meta.resolve("node:fs");"#, false),
    (r#"import.meta.resolve("bun:test");"#, false),
    (r#"import.meta.resolve(".\\a");"#, false),
    (r#"import.meta.resolve("..\\a");"#, false),
    (r#"import.meta.resolve("\\a");"#, false),
    (r#"import.meta.resolve("." + "/a");"#, false),
    ("import.meta.resolve(x);", false),
    (r#"import.meta.require("./a");"#, true),
    (r#"require.resolve("./a");"#, true),
    (r#"require("./a");"#, true),
    ("require(x);", true),
    (r#"import("./a");"#, true),
    (r#"process.getBuiltinModule("node:fs");"#, true),
    (r#"import "./a";"#, true),
    (r#"export * from "./a";"#, true),
    ("import.meta.resolve(`./${x}`);", false),
    ("import.meta.resolve(`a/${x}`);", false),
    ("require.resolve(`./${x}`);", true),
];

const BUILTIN_MODULE_CALLS: &[(&str, usize)] = &[
    (r#"process.getBuiltinModule("node:fs");"#, 1),
    (r#"process.getBuiltinModule("node:" + "fs");"#, 1),
    (r#"process["getBuiltinModule"]("node:fs");"#, 1),
    ("process.getBuiltinModule(x);", 0),
    ("process.getBuiltinModule(`node:${x}`);", 0),
    ("process.getBuiltinModule();", 0),
    (
        r#"function f(process) { process.getBuiltinModule("node:fs"); }"#,
        0,
    ),
    (r#"other.getBuiltinModule("node:fs");"#, 0),
];

const MADE_REQUIRES: &[(&str, &str, &[&str])] = &[
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const load = createRequire(import.meta.url); load("a"); load("b");"#,
        &["a", "b"],
    ),
    (
        "a.mts",
        r#"import { createRequire as make } from "module"; make(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import * as m from "node:module"; const load = m.createRequire(import.meta.url); load("a");"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import m from "node:module"; (m.createRequire(import.meta.url) as any)("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const { createRequire } = require("module"); const load = createRequire(__filename); load("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"const m = require("node:module"); const load = m.createRequire(__filename); load("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.cjs",
        r#"const load = require("node:module").createRequire(__filename); load("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load = createRequire(import.meta.url); load = other; load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const load = createRequire(elsewhere); load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "./module"; const load = createRequire(import.meta.url); load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { other as createRequire } from "node:module"; const load = createRequire(import.meta.url); load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"function createRequire(url) { return url; } const load = createRequire(import.meta.url); load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function f(createRequire) { createRequire(import.meta.url)("a"); }"#,
        &[],
    ),
    (
        "a.mts",
        r#"import type { createRequire } from "node:module"; createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const { createRequire } = require("module"); __filename = other; createRequire(__filename)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"const { createRequire } = require("module"); eval(text); createRequire(__filename)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"const { createRequire } = require("module"); arguments[3] = other; createRequire(__filename)("a");"#,
        &["module"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; import.meta.url = other; createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const meta = import.meta; createRequire(import.meta.url)("a");"#,
        &[],
    ),
];

const REQUIRES_AS_VALUES: &[(&str, &str, &[&str])] = &[
    ("a.cjs", r#"const load = require; load("a");"#, &["a"]),
    (
        "a.cjs",
        r#"const load = require; const again = load; again("a");"#,
        &["a"],
    ),
    (
        "a.cts",
        r#"const load = require as any; (load as any)("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"function f() { return load("a"); } const load = require;"#,
        &["a"],
    ),
    ("a.cjs", r#"require.call(this, "a");"#, &["a"]),
    ("a.cjs", r#"require.call(this, "a", x);"#, &["a"]),
    ("a.cjs", r#"require.apply(this, ["a"]);"#, &["a"]),
    (
        "a.cjs",
        r#"const load = require; load.call(null, "a"); load.apply(null, ["b"]);"#,
        &["a", "b"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const made = createRequire(import.meta.url); const load = made; load("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"var __require = ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, { get: (a, b) => (typeof require !== "undefined" ? require : a)[b] }) : x)(function(x) { if (typeof require !== "undefined") return require.apply(this, arguments); throw Error(x); }); __require("a"); __require.resolve("b");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"var t=(a=>typeof require<"u"?require:a)(function(a){throw Error(a)});t("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const load = (() => require)(); load("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const load = (function () { return require; })(); load("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"(typeof require === "function" ? require : other)("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const load = (flag ? require : other); load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const load = (async () => require)(); load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const load = (function* () { return require; })(); load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const load = (() => { if (flag) return other; return require; })(); load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const load = (r => r)(require); load("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const make = () => require; const load = make(); load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"let load = require; load = other; load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"function f(load) { load("a"); } f(require);"#,
        &[],
    ),
    ("a.cjs", r#"(r => r("a"))(require);"#, &["a"]),
    (
        "a.cjs",
        r#"const holder = { load: require }; holder.load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const { load } = { load: require }; load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"function f(require) { const load = require; load("a"); }"#,
        &[],
    ),
    ("a.cjs", r#"require.bind(null)("a");"#, &[]),
    (
        "a.cjs",
        r#"const load = require.bind(null); load("a");"#,
        &[],
    ),
    ("a.cjs", "require.call(this);", &[]),
    ("a.cjs", r#"require.apply(this, list);"#, &[]),
    ("a.cjs", r#"require.apply(this, []);"#, &[]),
    ("a.cjs", r#"require.apply(this, [...list]);"#, &[]),
    ("a.cjs", r#"require.apply(this, [, "a"]);"#, &[]),
    ("a.cjs", r#"require.apply(this, ["a"], x);"#, &[]),
    ("a.cjs", r#"require["call"](this, "a");"#, &["a"]),
    ("a.cjs", r#"require[call](this, "a");"#, &[]),
    ("a.cjs", r#"other.call(require, "a");"#, &[]),
];

const BINDINGS_OF_IMPORT_META_REQUIRE: &[(&str, &[&str])] = &[
    (
        r#"var __require = import.meta.require; __require("a");"#,
        &["a"],
    ),
    (
        r#"const load = import.meta.require; const again = load; again("a"); load("b");"#,
        &["a", "b"],
    ),
    (
        r#"function f() { return load("a"); } const load = import.meta.require;"#,
        &["a"],
    ),
    (
        r#"const load = import.meta.require as any; (load as any)("a");"#,
        &["a"],
    ),
    (r#"const load = import.meta["require"]; load("a");"#, &["a"]),
    (
        r#"let load = import.meta.require; load = other; load("a");"#,
        &[],
    ),
    (
        r#"function f(load) { load("a"); } f(import.meta.require);"#,
        &[],
    ),
    (r#"const { require: load } = import.meta; load("a");"#, &[]),
    (r#"const load = import.meta.resolve; load("a");"#, &[]),
    (r#"const load = other.require; load("a");"#, &[]),
    (
        r#"const load = import.meta.require.bind(null); load("a");"#,
        &[],
    ),
];

fn callee_names<'w>(w: &'w Workspace<'_>, hir: &File<'_>, calls: &[ExprId]) -> Vec<&'w str> {
    let callee_name = |&call: &ExprId| {
        let ExprKind::Call(call) = hir[call].kind else {
            panic!("{:?} is no call", hir[call].kind);
        };
        let ExprKind::Ident(name) = hir[hir[call].callee].kind else {
            panic!("{:?} is no identifier", hir[hir[call].callee].kind);
        };
        w.text(name)
    };
    calls.iter().map(callee_name).collect()
}

#[track_caller]
fn only_site(s: &Analyzed<'_>, text: &str) -> ImportSite {
    let [site] = s.analysis.import_sites else {
        panic!("{text}: {:?}", s.analysis.import_sites);
    };
    *site
}

#[track_caller]
fn first_argument_of_last_call(hir: &File<'_>) -> ExprId {
    let calls = find_exprs(hir, |kind| {
        matches!(kind, ExprKind::Call(_) | ExprKind::ImportCall { .. })
    });
    let args = match hir[calls[calls.len() - 1]].kind {
        ExprKind::Call(call) => hir[call].args,
        ExprKind::ImportCall { args } => args,
        kind => panic!("{kind:?} is no call"),
    };
    hir.id_at(args, 0)
}

#[test]
fn pending_macro_calls_end_at_guarded_call() {
    for &(text, names) in PENDING_MACRO_CALLS {
        analyzed("a.ts", &[MACROS, text].concat(), |s| {
            let pending = s.analysis.pending_macro_calls;
            assert_eq!(callee_names(&s.workspace, &s.hir, pending), names, "{text}");
        });
    }
}

#[test]
fn guarded_macro_calls_follow_result() {
    let rounds: [(Data<'_>, &[&str]); 2] = [
        (Data::Number(0.0), &["g", "h"]),
        (Data::Number(1.0), &["f", "h"]),
    ];
    for (result, names) in rounds {
        with_workspace(|w| {
            let text = [MACROS, "zero() ? f() : g(); h();"].concat();
            let source = Source::new("a.ts", &text);
            let fold = w.fold_inputs(&Fold::NONE);
            let mut hir = w.parse(&source);
            let (_, first) = w.analyze_tree(&mut hir, &source, &fold, &[]);
            let &[zero] = first.pending_macro_calls else {
                panic!("pending: {:?}", first.pending_macro_calls);
            };
            let results = [(zero, w.host_data(&result))];
            let (_, second) = w.analyze_tree(&mut hir, &source, &fold, &results);
            assert_eq!(callee_names(w, &hir, second.pending_macro_calls), names);
        });
    }
}

#[test]
fn macro_callee_names_binding_and_member() {
    let text = r#"import d, * as m from "./m" with { type: "macro" }; d(); m.f(); m(); d.f();"#;
    analyzed("a.ts", text, |s| {
        let default = s.bound.declared_symbol(Decl::ImportDefault(ImportId(0)));
        let namespace = s.bound.declared_symbol(Decl::ImportNamespace(ImportId(0)));
        let mut macro_symbols = [default, namespace];
        macro_symbols.sort_unstable();
        let calls = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Call(_)));
        let callees: Vec<Option<(SymbolId, Option<Atom>)>> = calls
            .iter()
            .map(|&call| macro_callee(&s.hir, &s.bound, &macro_symbols, call))
            .collect();
        let member_call = Some((namespace, Some(s.workspace.atom("f"))));
        assert_eq!(callees, [Some((default, None)), member_call, None, None]);
        assert_eq!(s.analysis.pending_macro_calls, &calls[..2]);
    });
}

#[test]
fn specifier_node_is_first_argument() {
    for &text in CALL_SITES {
        analyzed("a.mts", text, |s| {
            let expected = first_argument_of_last_call(&s.hir);
            assert_eq!(only_site(s, text).specifier_node, expected, "{text}");
        });
    }
    analyzed("a.mts", STATEMENT_SITES, |s| {
        let sites = s.analysis.import_sites;
        assert_eq!(sites.len(), 4);
        assert!(sites.iter().all(|site| site.specifier_node.is_none()));
    });
}

#[test]
fn import_meta_resolve_without_resolver() {
    for &(text, consults_resolver) in RESOLVER_USES {
        analyzed("a.mts", text, |s| {
            let site = only_site(s, text);
            assert_eq!(site.consults_resolver, consults_resolver, "{text}");
        });
    }
}

#[test]
fn builtin_module_call_needs_constant_specifier() {
    for &(text, count) in BUILTIN_MODULE_CALLS {
        analyzed("a.mts", text, |s| {
            assert_eq!(s.analysis.import_sites.len(), count, "{text}");
        });
    }
}

#[test]
fn call_of_require_made_for_own_file_is_site() {
    let programs = MADE_REQUIRES.iter().chain(REQUIRES_AS_VALUES);
    for &(path, text, specifiers) in programs.chain(REQUIRES_AS_ARGUMENTS) {
        analyzed(path, text, |s| {
            let sites = s.analysis.import_sites.iter();
            let required = sites.filter_map(|site| match (site.kind, site.specifier) {
                (ImportSiteKind::Require(_), ImportSpecifier::Constant(name)) => {
                    Some(s.workspace.text(name))
                }
                _ => None,
            });
            assert_eq!(required.collect::<Vec<&str>>(), specifiers, "{text}");
        });
    }
}

const REQUIRES_AS_ARGUMENTS: &[(&str, &str, &[&str])] = &[
    (
        "a.cjs",
        r#"(function (load) { load("./a"); load("b"); })(require);"#,
        &["./a", "b"],
    ),
    ("a.cjs", r#"(load => load("./a"))(require);"#, &["./a"]),
    (
        "a.cjs",
        r#"(function (one, load) { load("./a"); one("./b"); })(exports, require);"#,
        &["./a"],
    ),
    (
        "a.cjs",
        r#"(function (factory) { if (typeof module === "object") factory(require, exports); else define(["./c"], factory); })(function (require, exports) { require("./a"); require("./" + "b"); });"#,
        &["./a", "./b"],
    ),
    (
        "a.cjs",
        r#"(function (factory) { factory(other); factory(require); })(function (load) { load("./a"); });"#,
        &["./a"],
    ),
    (
        "a.cjs",
        r#"(function (outer) { (function (inner) { inner("./a"); })(outer); })(require);"#,
        &["./a"],
    ),
    (
        "a.cjs",
        r#"const own = require; (load => load("./a"))(own);"#,
        &["./a"],
    ),
    (
        "a.cjs",
        r#"(function (load) { load.call(null, "./a"); load.apply(null, ["./b"]); })(require);"#,
        &["./a", "./b"],
    ),
    (
        "a.cjs",
        r#"(function (load) { load("./a"); })(other);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function (load) { load("./a"); load = other; })(require);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function (load = other) { load("./a"); })(require);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function (...loaders) { loaders("./a"); })(require);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function ({ load }) { load("./a"); })(require);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function (one, load) { load("./a"); })(...list, require);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function (load) { eval(text); load("./a"); })(require);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function (factory) { if (false) factory(require); })(function (load) { load("./a"); });"#,
        &[],
    ),
    (
        "a.cjs",
        r#"(function (factory) { other(factory, require); })(function (load) { load("./a"); });"#,
        &[],
    ),
    (
        "a.cjs",
        r#"other(function (load) { load("./a"); }, require);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"function f(require) { (load => load("./a"))(require); }"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; (load => load("./a"))(createRequire(import.meta.url));"#,
        &[],
    ),
];

#[test]
fn call_of_binding_that_holds_import_meta_require_is_site() {
    for &(text, specifiers) in BINDINGS_OF_IMPORT_META_REQUIRE {
        analyzed("a.mts", text, |s| {
            let sites = s.analysis.import_sites.iter();
            let required = sites.filter_map(|site| match (site.kind, site.specifier) {
                (ImportSiteKind::ImportMetaRequire(_), ImportSpecifier::Constant(name)) => {
                    Some(s.workspace.text(name))
                }
                _ => None,
            });
            assert_eq!(required.collect::<Vec<&str>>(), specifiers, "{text}");
        });
    }
}

#[test]
fn parsed_call_is_no_host_value() {
    for &text in CALL_SITES {
        analyzed("a.mts", text, |s| {
            assert!(!only_site(s, text).is_host_value, "{text}")
        });
    }
}
