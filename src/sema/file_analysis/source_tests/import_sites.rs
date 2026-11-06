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
    (
        r#"import process from "node:process"; process.getBuiltinModule("node:fs");"#,
        2,
    ),
    (
        r#"import * as host from "process"; host.getBuiltinModule("node:fs");"#,
        2,
    ),
    (
        r#"import process from "./process"; process.getBuiltinModule("node:fs");"#,
        1,
    ),
    (
        r#"import { env as process } from "node:process"; process.getBuiltinModule("node:fs");"#,
        1,
    ),
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
    (
        "a.mjs",
        r#"process.getBuiltinModule("node:module").createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const { createRequire } = process.getBuiltinModule("node:module"); createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const { createRequire: make } = globalThis.process.getBuiltinModule("module"); const load = make(import.meta.url); load("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const host = process; const m = host.getBuiltinModule("node:module"); m.createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const createRequire = process.getBuiltinModule("node:module").createRequire; createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"function f() { return load("a"); } const load = m.createRequire(import.meta.url); var m = process.getBuiltinModule("node:module");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const createRequire = require("node:module").createRequire; createRequire(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.cjs",
        r#"const m = require("node:module"); const again = m; const make = again.createRequire; const same = make; same(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.cjs",
        r#"module.require("node:module").createRequire(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.cjs",
        r#"require.call(null, "node:module").createRequire(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.cjs",
        r#"const load = require; load("node:module").createRequire(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.cjs",
        r#"require("node:module").Module.createRequire(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.cjs",
        r#"const { Module: { createRequire } } = require("node:module"); createRequire(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; createRequire(import.meta.url)("node:module").createRequire(import.meta.url)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.mjs",
        r#"import * as m from "node:module"; m.default.createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { Module } from "node:module"; Module.createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"(await import("node:module")).createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"(await import("node:module")).default.createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const { createRequire } = await import("node:module"); createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const { default: { createRequire } } = await import("node:module"); createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import.meta.require("node:module").createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import process from "node:process"; process.getBuiltinModule("node:module").createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const m = (() => require("node:module"))(); m.createRequire(__filename)("a");"#,
        &["node:module", "a"],
    ),
    (
        "a.mjs",
        r#"process.getBuiltinModule("node:fs").createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"process.getBuiltinModule(name).createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"other.getBuiltinModule("node:module").createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"function f(process) { process.getBuiltinModule("node:module").createRequire(import.meta.url)("a"); }"#,
        &[],
    ),
    (
        "a.mjs",
        r#"process.getBuiltinModule("node:module").other.createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"process.getBuiltinModule("node:module").createRequire.other(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"process.getBuiltinModule("node:module")[name](import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"let m = process.getBuiltinModule("node:module"); m = other; m.createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"import("node:module").createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"(await other("node:module")).createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"require.resolve("node:module").createRequire(__filename)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const load = load("node:module").createRequire(__filename); load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const a = b.createRequire; const b = a("node:module"); a(__filename)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"require("node:module").default.createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.mjs",
        r#"import m from "node:module"; m.default.createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"import * as m from "node:module"; m.default.default.createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"import * as m from "node:module"; m.Module.default.createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"import * as m from "node:module"; m.default.Module.createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { default as m } from "node:module"; m.createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { default as m } from "node:module"; m.default.createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"process.getBuiltinModule("node:module").default.createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"global.process.getBuiltinModule("node:module").createRequire(__filename)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const host = global; host.process.getBuiltinModule("node:module").createRequire(__filename)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"require = other; require("node:module").createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"const load = require; require = other; load("node:module").createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"require = other; module.require("node:module").createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"require.call = other; require.call(null, "node:module").createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"change(require); require.call(null, "node:module").createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"const load = require; load("b"); require.apply(null, ["node:module"]).createRequire(__filename)("a");"#,
        &["b", "node:module", "a"],
    ),
    (
        "a.cjs",
        r#"const load = require; load.apply = other; require.apply(null, ["node:module"]).createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"const load = require, same = load; change(same); require.apply(null, ["node:module"]).createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"let load = require; load = other; require.apply(null, ["node:module"]).createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.mjs",
        r#"export const load = require; require.call(null, "node:module").createRequire(import.meta.url)("a");"#,
        &["node:module"],
    ),
    (
        "a.mjs",
        r#"const load = require; export { load }; require.call(null, "node:module").createRequire(import.meta.url)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"delete require.call; require.call(null, "node:module").createRequire(__filename)("a");"#,
        &["node:module"],
    ),
    (
        "a.cjs",
        r#"typeof require; require.resolve("b"); require("c"); require.call(null, "node:module").createRequire(__filename)("a");"#,
        &["c", "node:module", "a"],
    ),
    (
        "a.mjs",
        r#"import.meta.require = other; import.meta.require("node:module").createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"change(import.meta); import.meta.require("node:module").createRequire(import.meta.url)("a");"#,
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

const TARGET: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["process", "platform"]),
            Defined::Value(Data::String("linux")),
        ),
        (
            Path::Global(&["process", "arch"]),
            Defined::Value(Data::String("x64")),
        ),
    ],
    ..Fold::NONE
};

/// The last call names one of these. A text with `*` stands for its start and its end. That two arms of a condition exclude each other is not looked at.
const NAMES_THAT_ARE_ONE_OF_A_FEW: &[(&str, &[&str])] = &[
    (
        "const names = { linux: `./a-${process.arch}`, darwin: './b' }; require(names[process.platform]);",
        &["./a-x64"],
    ),
    (
        "const names = { linux: './a', darwin: './b' }; require(names[key]);",
        &["./a", "./b"],
    ),
    (
        "const names = { linux: { x64: { base: 'gnu', musl: 'musl' } } };
         function find() { const found = names[process.platform]?.[process.arch]; if (!found) throw 1; if ('musl' in found && c) return found.musl; return found.base; }
         const target = find(); require(`./a.${target}.node`);",
        &["./a.gnu.node", "./a.musl.node"],
    ),
    (
        "const { platform, arch } = require('node:process'); require(`./a.${platform}-${arch}.node`);",
        &["./a.linux-x64.node"],
    ),
    (
        "const load = id => { try { return require(id); } catch { throw 1; } }; load(c ? './a' : `@b/${process.platform}`);",
        &["./a", "@b/linux"],
    ),
    (
        "const paths = ['./a', `./b-${process.arch}`, `./c/${x}.node`]; for (const path of paths) { try { require(path); } catch {} }",
        &["./a", "./b-x64", "./c/*.node"],
    ),
    (
        "let name = `@a/b-${process.platform}`; if (c) { if (d) name += '-musl'; else name += '-glibc'; } require(name);",
        &[
            "@a/b-linux",
            "@a/b-linux-glibc",
            "@a/b-linux-musl",
            "@a/b-linux-musl-glibc",
        ],
    ),
    (
        "let name = './a'; if (c) name = './b'; require(name);",
        &["./a", "./b"],
    ),
    (
        "const parts = [process.platform, process.arch]; if (c) parts.push('musl'); else if (d) parts.push('gnu'); require(`a-${parts.join('-')}`);",
        &[
            "a-linux-x64",
            "a-linux-x64-gnu",
            "a-linux-x64-musl",
            "a-linux-x64-musl-gnu",
        ],
    ),
    (
        "const name = c ? 'a' : 'b'; require(`${__dirname}/lib/${name}.js`);",
        &["./lib/a.js", "./lib/b.js"],
    ),
    (
        "const { join } = require('path'); const name = c ? 'a' : '../b'; require(join(__dirname, 'lib', name + '.js'));",
        &["./b.js", "./lib/a.js"],
    ),
    (
        "const path = require('node:path'); const folder = c ? 'a' : 'b'; require(path.resolve(__dirname, folder, `${x}.js`));",
        &["./a/*.js", "./b/*.js"],
    ),
    (
        "const os = require('node:os'); require(`./a.${os.platform()}-${os.arch()}.node`);",
        &["./a.linux-x64.node"],
    ),
    (
        "const { platform } = require('os'); require(`./a.${platform()}.node`);",
        &["./a.linux.node"],
    ),
    (
        "['a', 'b'].forEach(name => { try { require(`./${name}.node`); } catch {} });",
        &["./a.node", "./b.node"],
    ),
    (
        "const paths = ['a', 'b'].map(name => `./${name}.node`); for (const path of paths) require(path);",
        &["./a.node", "./b.node"],
    ),
    (
        "const name = ['a', 'b'].find(name => exists(name)); require(`./${name}.node`);",
        &["./a.node", "./b.node", "./undefined.node"],
    ),
    (
        "const names = ['a', 'b'].filter(name => exists(name)); require(`./${names[0]}.node`);",
        &["./a.node", "./b.node", "./undefined.node"],
    ),
    (
        "const table = { first: 'a', second: 'b' }; for (const name of Object.values(table)) require(`./${name}.node`);",
        &["./a.node", "./b.node"],
    ),
    (
        "const table = { a: 1, b: 2 }; for (const name of Object.keys(table)) require(`./${name}.node`);",
        &["./a.node", "./b.node"],
    ),
    (
        "const name = a || './a'; require(name ?? './b');",
        &[],
    ),
    (
        "const name = (c ? './a' : null) || './b'; require(name);",
        &["./a", "./b"],
    ),
];

/// Something may change the list, the object or the variable in a way that the build does not follow.
const NAMES_THAT_ARE_NOT_FOLLOWED: &[&str] = &[
    "const names = { linux: './a' }; names.linux = x; require(names[process.platform]);",
    "const names = { linux: './a' }; change(names); require(names[process.platform]);",
    "const names = { linux: './a' }; const other = names; other[k] = x; require(names[process.platform]);",
    "const names = { linux: './a' }; delete names.linux; require(names[process.platform]);",
    "const names = { linux: { x64: './a' } }; change(names.linux); require(names.linux.x64);",
    "const names = { linux: './a', ...more }; require(names[process.platform]);",
    "const names = { get linux() { return x; } }; require(names[process.platform]);",
    "export const names = { linux: './a' }; require(names[process.platform]);",
    "const parts = ['a']; for (const x of y) parts.push('b'); require(parts.join('-'));",
    "const parts = ['a']; function more() { parts.push('b'); } require(parts.join('-'));",
    "const parts = ['a']; const count = parts.push('b'); require(parts.join('-'));",
    "const parts = ['a']; parts.pop(); require(parts.join('-'));",
    "const parts = ['a', ...more]; require(parts.join('-'));",
    "require([x, 'a.js'].join('/'));",
    "const parts = ['a'].map(name => name); require(parts.join('-'));",
    "const names = ['./a']; names.forEach(function (name) { arguments[0] = x; require(name); });",
    "const names = ['./a']; names.forEach((name = x) => require(name));",
    "const names = ['./a']; names.forEach((index, name) => require(name));",
    "const names = [{ a: './a' }]; names.forEach(name => change(name)); require(names[0].a);",
    "function f(Object) { const table = { a: './a' }; for (const name of Object.values(table)) require(name); }",
    "const table = { a: { b: './a' } }; for (const inner of Object.values(table)) change(inner); require(table.a.b);",
    "for (const name in table) require(name);",
    "for await (const name of ['./a']) require(name);",
    "let name = './a'; while (c) name += 'b'; require(name);",
    "let name = './a'; const grow = () => { name += 'b'; }; require(name);",
    "let name = './a'; name += name; require(name);",
    "let name = './a'; [name] = x; require(name);",
    "const load = id => require(id); load('./a'); hand(load);",
    "function find() { return find(); } require(find());",
    "async function find() { return './a'; } require(find());",
];

/// What is read out of the list or the object that changes is any text. The other parts of the name are followed.
const NAMES_WITH_A_PART_OUT_OF_WHAT_MAY_CHANGE: &[(&str, &[&str])] = &[
    (
        "const names = ['A']; names.forEach((name, index, all) => { all[index] = x; }); require(['./lib', names[0] + '.js'].join('/'));",
        &["./lib/*.js"],
    ),
    (
        "const names = ['A']; names.forEach((name, index, all) => { const same = all; same.reverse(); }); require(['./lib', names[0] + '.js'].join('/'));",
        &["./lib/*.js"],
    ),
    (
        "const names = ['b', 'a']; names.sort(); require(['./lib', names[0] + '.js'].join('/'));",
        &["./lib/*.js"],
    ),
    (
        "const names = { a: 'A' }; const same = names; same.a = x; const parts = ['./lib']; parts.push(names.a + '.js'); require(parts.join('/'));",
        &["./lib", "./lib/*.js"],
    ),
    (
        "const folders = ['a', 'b']; const names = ['c']; change(names); for (const folder of folders) require(['.', folder, names[0] + '.js'].join('/'));",
        &["./a/*.js", "./b/*.js"],
    ),
    (
        "const names = ['a']; names[0] = x; require(c ? './b' : ['./lib', names[0] + '.js'].join('/'));",
        &["./b", "./lib/*.js"],
    ),
    (
        "const names = ['a.js']; names[0] = x; require(['./lib', names[0]].join('/'));",
        &["./lib/*"],
    ),
    (
        "const parts = ['./lib']; parts.push(x); require(parts.join('/'));",
        &["./lib", "./lib/*"],
    ),
    (
        "const names = ['a']; names[0] = x; for (const file of names.map(name => `./lib/${name}.js`)) require(file);",
        &["./lib/*.js"],
    ),
];

fn describe_alternatives(s: &Analyzed<'_>, site: &ImportSite) -> Vec<String> {
    let alternatives = s.analysis.alternatives_of(&site.specifier).iter();
    let described = alternatives.filter_map(|&it| match it {
        ImportSpecifier::Constant(text) => Some(s.workspace.text(text).to_owned()),
        ImportSpecifier::Pattern { prefix, suffix } => {
            let (prefix, suffix) = (s.workspace.text(prefix), s.workspace.text(suffix));
            Some(format!("{prefix}*{suffix}"))
        }
        ImportSpecifier::OneOf(_) | ImportSpecifier::Unknown => None,
    });
    described.collect()
}

fn with_last_site(text: &str, test: impl for<'s> FnOnce(&Analyzed<'s>, &ImportSite) + Send) {
    with_workspace(|w| {
        let inputs = w.fold_inputs(&TARGET);
        let path = if text.starts_with("export") {
            "a.mjs"
        } else {
            "a.cjs"
        };
        let s = w.analyze(&Source::new(path, text), &inputs);
        let site = s.analysis.import_sites.last();
        test(&s, site.unwrap_or_else(|| panic!("{text}: no import site")));
    });
}

#[test]
fn name_is_one_of_a_few_texts() {
    for &(text, names) in NAMES_THAT_ARE_ONE_OF_A_FEW {
        with_last_site(text, |s, site| {
            assert_eq!(describe_alternatives(s, site), names, "{text}");
        });
    }
}

#[test]
fn name_out_of_what_may_change_is_not_followed() {
    for &text in NAMES_THAT_ARE_NOT_FOLLOWED {
        with_last_site(text, |_, site| {
            assert_eq!(site.specifier, ImportSpecifier::Unknown, "{text}");
        });
    }
}

#[test]
fn part_of_name_out_of_what_may_change_is_any_text() {
    for &(text, names) in NAMES_WITH_A_PART_OUT_OF_WHAT_MAY_CHANGE {
        with_last_site(text, |s, site| {
            assert_eq!(describe_alternatives(s, site), names, "{text}");
        });
    }
}

const NAMES_THAT_A_RESOLVER_ANSWERED_FOR: &[(&str, ResolvedForm, &[&str])] = &[
    (
        "require(require.resolve('./a'));",
        ResolvedForm::Path,
        &["./a"],
    ),
    (
        "const found = require.resolve(c ? './a' : './b'); require(found);",
        ResolvedForm::Path,
        &["./a", "./b"],
    ),
    (
        "let found; try { found = require.resolve('a/b'); } catch { found = null; } if (found) require(found);",
        ResolvedForm::Path,
        &["a/b"],
    ),
    (
        "require(require.resolve(`./a/${x}.js`));",
        ResolvedForm::Path,
        &["./a/*.js"],
    ),
    (
        "const names = ['A']; names.forEach((name, index, all) => { all[index] = x; }); require(require.resolve('./a/' + names[0] + '.js'));",
        ResolvedForm::Path,
        &["./a/*.js"],
    ),
    (
        "require(require.resolve(require('path').join(__dirname, 'a.js')));",
        ResolvedForm::Path,
        &["./a.js"],
    ),
    (
        "const load = file => require(file); load(require.resolve('./a')); load(require.resolve('fs'));",
        ResolvedForm::Path,
        &["./a", "fs"],
    ),
    (
        "require(require.resolve(require.resolve('./a')));",
        ResolvedForm::Path,
        &["./a"],
    ),
    (
        "import(require.resolve('./a'));",
        ResolvedForm::Path,
        &["./a"],
    ),
    (
        "export {}; await import(import.meta.resolve(c ? './a' : './b'));",
        ResolvedForm::Url,
        &["./a", "./b"],
    ),
    (
        "export {}; const names = ['a']; names.fill(x); await import(import.meta.resolve(`./a/${names[0]}.js`));",
        ResolvedForm::Url,
        &["./a/*.js"],
    ),
];

const ANSWERS_OF_RESOLVERS_THAT_ARE_NOT_FOLLOWED: &[&str] = &[
    "require(require.resolve('./a') + '.map');",
    "require(require.resolve('./a').replace('a', 'b'));",
    "require(c ? require.resolve('./a') : './b');",
    "require(require.resolve('./a', { paths: [x] }));",
    "require(require.resolve(x));",
    "export {}; await import(c ? import.meta.resolve('./a') : require.resolve('./b'));",
];

fn find_site_given_answer_of_resolver<'a>(
    s: &'a Analyzed<'_>,
) -> Option<(&'a ImportSite, ResolvedForm)> {
    let mut sites = s.analysis.import_sites.iter();
    sites.find_map(|site| {
        let form = s.analysis.find_resolved_form(site.specifier_node)?;
        Some((site, form))
    })
}

#[test]
fn name_is_what_a_resolver_was_asked_for() {
    for &(text, form, names) in NAMES_THAT_A_RESOLVER_ANSWERED_FOR {
        with_last_site(text, |s, _| {
            let found = find_site_given_answer_of_resolver(s);
            let (site, found_form) = found.unwrap_or_else(|| panic!("{text}: not followed"));
            assert_eq!(found_form, form, "{text}");
            assert_eq!(describe_alternatives(s, site), names, "{text}");
        });
    }
}

#[test]
fn answer_of_a_resolver_that_is_changed_or_mixed_is_not_followed() {
    for &text in ANSWERS_OF_RESOLVERS_THAT_ARE_NOT_FOLLOWED {
        with_last_site(text, |s, _| {
            assert!(find_site_given_answer_of_resolver(s).is_none(), "{text}");
        });
    }
}

#[test]
fn name_that_a_loop_takes_out_of_an_object_is_known_by_its_start_and_end() {
    let text = "for (const name in table) require(`./lib/${name}.js`);";
    with_last_site(text, |s, site| {
        assert_eq!(describe_alternatives(s, site), ["./lib/*.js"], "{text}");
    });
}
