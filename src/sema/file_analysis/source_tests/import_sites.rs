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
    // What is made is asked for on the way to what it is made of.
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const load = createRequire(load("url").fileURLToPath(import.meta.url)); load("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const load = require("module").createRequire(load("path").join(__dirname, "lib", "index.js")); load("a");"#,
        &["module"],
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
        "const path = require('path'); const folder = path.join(__dirname, 'lib'); require(path.join(folder, x));",
        &["./lib/*"],
    ),
    (
        "const path = require('path'); const all = path.join(__dirname, 'lib'); const folder = path.join(all, x); require(path.join(folder, y));",
        &["./lib/*"],
    ),
    (
        "const path = require('path'); function walk(folder) { for (const name of list(folder)) { const full = path.join(folder, name); if (c(full)) walk(full); else require(full); } } walk(path.join(__dirname, 'lib'));",
        &["./lib/*"],
    ),
    (
        "const path = require('path'); function walk(folder) { for (const name of list(folder)) { if (c(name)) walk(path.join(folder, name)); else require(path.join(folder, name + '.js')); } } walk(path.join(__dirname, 'lib'));",
        &["./lib/*.js"],
    ),
    (
        "const { join } = require('path'); require(join(__dirname, 'lib', x, y + '.js'));",
        &["./lib/*.js"],
    ),
    (
        "const { join } = require('path'); require(join(__dirname, 'lib', x, 'a', 'index.js'));",
        &["./lib/*/a/index.js"],
    ),
    (
        "const path = require('path'); const folder = path.resolve(__dirname, 'lib', 'b'); require(path.join(folder, '..', x + '.js'));",
        &["./lib/*.js"],
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
    describe_specifier(s, &site.specifier)
}

fn describe_specifier(s: &Analyzed<'_>, specifier: &ImportSpecifier) -> Vec<String> {
    let alternatives = s.analysis.alternatives_of(specifier).iter();
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
    (
        "export {}; await import(new URL('./a.js', import.meta.url));",
        ResolvedForm::UrlObject,
        &["./a.js"],
    ),
    (
        "export {}; await import(new URL(`a/${x}.js`, import.meta.url));",
        ResolvedForm::UrlObject,
        &["./a/*.js"],
    ),
    (
        "export {}; const found = new URL('../a/' + x, import.meta.url); await import(found.href);",
        ResolvedForm::Url,
        &["../a/*"],
    ),
    (
        "export {}; await import(`${new URL(`./a/${x}.js`, import.meta.url)}`);",
        ResolvedForm::Url,
        &["./a/*.js"],
    ),
    (
        "export {}; await import(String(new URL(new URL(`./a/${x}.js`, import.meta.url))));",
        ResolvedForm::Url,
        &["./a/*.js"],
    ),
    (
        "import { fileURLToPath } from 'node:url'; await import(fileURLToPath(new URL(`./a/${x}.js`, import.meta.url)));",
        ResolvedForm::Path,
        &["./a/*.js"],
    ),
    (
        "import(require('url').pathToFileURL(require('path').join(__dirname, 'a', x + '.js')).href);",
        ResolvedForm::Url,
        &["./a/*.js"],
    ),
    (
        "import(require('node:url').pathToFileURL(require.resolve('./a')));",
        ResolvedForm::UrlObject,
        &["./a"],
    ),
    (
        "export {}; const folder = new URL('./a/', import.meta.url); await import(new URL(x, folder));",
        ResolvedForm::UrlObject,
        &["./a/*"],
    ),
    (
        "export {}; await import(new URL('./c.js', new URL('../a/b.js', import.meta.url)).href);",
        ResolvedForm::Url,
        &["../a/c.js"],
    ),
    (
        "const path = require('path'), folder = path.join(__dirname, 'a'); import(require('url').pathToFileURL(path.join(folder, x)).href);",
        ResolvedForm::Url,
        &["./a/*"],
    ),
    (
        "require(require.resolve(`./a/${x}.js`).trim());",
        ResolvedForm::Path,
        &["./a/*.js"],
    ),
    (
        "require(require('path').normalize(require.resolve('./a') + ''));",
        ResolvedForm::Path,
        &["./a"],
    ),
];

const ANSWERS_OF_RESOLVERS_THAT_ARE_NOT_FOLLOWED: &[&str] = &[
    "require(require.resolve('./a') + '.map');",
    "require(require.resolve('./a').replace('a', 'b'));",
    "require(c ? require.resolve('./a') : './b');",
    "require(require.resolve('./a', { paths: [x] }));",
    "require(require.resolve(x));",
    "export {}; await import(c ? import.meta.resolve('./a') : require.resolve('./b'));",
    "export {}; await import(new URL('./a.js', x));",
    "export {}; await import(new URL('./a.js', new URL(`./${x}/`, import.meta.url)));",
    "export {}; await import(new URL(x, import.meta.url));",
    "export {}; await import(new URL('/a.js', import.meta.url));",
    "export {}; await import(new URL('./a.js?b', import.meta.url));",
    "export {}; await import(new URL('https://a/' + x, import.meta.url));",
    "export {}; await import(new URL('./a.js', import.meta.url).search);",
    "export {}; await import(new URL('./a.js', import.meta.url).href + x);",
    "export {}; class URL {} await import(new URL('./a.js', import.meta.url));",
    "export {}; import.meta.url = x; await import(new URL('./a.js', import.meta.url));",
    "export {}; await import(c ? new URL('./a.js', import.meta.url) : import.meta.resolve('./b'));",
    "require(require.resolve('./a').trimEnd(x));",
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

const NAMES_OF_WORKERS_THAT_ARE_KNOWN_IN_PART: &[(&str, &[&str])] = &[
    ("new Worker('./a/' + x + '.js');", &["./a/*.js"]),
    (
        "new threads.Worker(c ? './a.js' : './b.js');",
        &["./a.js", "./b.js"],
    ),
    (
        "const { Worker } = require('node:worker_threads'); new Worker(require('path').join(__dirname, 'a', x));",
        &["./a/*"],
    ),
    ("new Worker(require.resolve('./a/' + x));", &["./a/*"]),
    (
        "export {}; new Worker(new URL(`./a/${x}.js`, import.meta.url), { name });",
        &["./a/*.js"],
    ),
];

const NAMES_OF_WORKERS_THAT_ARE_WHOLE_OR_UNKNOWN: &[&str] = &[
    "new Worker('./a.js');",
    "new Worker(x);",
    "new Worker(x + '.js');",
    "new Worker();",
    "new Other('./a/' + x);",
    "Worker('./a/' + x);",
    "if (false) new Worker('./a/' + x);",
];

fn describe_name_of_worker(text: &str) -> Option<Vec<String>> {
    let mut described = None;
    let path = if text.starts_with("export") {
        "a.mjs"
    } else {
        "a.cjs"
    };
    with_workspace(|w| {
        let s = &w.analyze(&Source::new(path, text), &w.fold_inputs(&TARGET));
        let constructions = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::New(_)));
        described = constructions.into_iter().find_map(|construction| {
            let ExprKind::New(call) = s.hir[construction].kind else {
                return None;
            };
            let argument = s.hir.ids(s.hir[call].args).next()?;
            let specifier = s.analysis.find_name_of_worker(argument)?;
            Some(describe_specifier(s, specifier))
        });
    });
    described
}

#[test]
fn name_of_a_worker_is_known_in_part() {
    for &(text, names) in NAMES_OF_WORKERS_THAT_ARE_KNOWN_IN_PART {
        let described = describe_name_of_worker(text);
        assert_eq!(described.unwrap_or_default(), names, "{text}");
    }
    for &text in NAMES_OF_WORKERS_THAT_ARE_WHOLE_OR_UNKNOWN {
        assert_eq!(describe_name_of_worker(text), None, "{text}");
    }
}

const PATHS_OF_CHANGED_FILES: &[(&str, &[&str])] = &[
    (
        "import { writeFileSync } from 'node:fs'; writeFileSync('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "import { writeFileSync as put } from 'fs'; put('a.js', text);",
        &["a.js"],
    ),
    (
        "import fs from 'node:fs'; fs.writeFileSync('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "import * as fs from 'node:fs'; const put = fs.appendFileSync; put('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "import fs from 'node:fs'; await fs.promises.writeFile('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "import { rm } from 'node:fs/promises'; await rm('/p/a.js');",
        &["/p/a.js"],
    ),
    (
        "import { renameSync } from 'node:fs'; renameSync('/p/a.js', '/p/b.js');",
        &["/p/a.js", "/p/b.js"],
    ),
    (
        "import { copyFileSync } from 'node:fs'; copyFileSync('/p/a.js', '/p/b.js');",
        &["/p/b.js"],
    ),
    (
        "import { openSync } from 'node:fs'; openSync('/p/a.js', 'w');",
        &["/p/a.js"],
    ),
    (
        "export {}; require('fs').unlinkSync('/p/a.js');",
        &["/p/a.js"],
    ),
    ("export {}; await Bun.write('/p/a.js', text);", &["/p/a.js"]),
    (
        "export {}; await Bun.write(Bun.file('/p/a.js'), text);",
        &["/p/a.js"],
    ),
    (
        "export {}; const file = Bun.file('/p/a.js'); await file.delete();",
        &["/p/a.js"],
    ),
    (
        "import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; writeFileSync(join(import.meta.dir, 'a.js'), text);",
        &["./a.js"],
    ),
    (
        "import { writeFileSync } from 'node:fs'; for (const name of ['a.js', 'b.js']) writeFileSync('/p/' + name, text);",
        &["/p/a.js", "/p/b.js"],
    ),
];

const CALLS_THAT_CHANGE_NO_FILE_THAT_IS_KNOWN: &[&str] = &[
    "import { writeFileSync } from 'node:fs'; writeFileSync(path, text);",
    "import { readFileSync } from 'node:fs'; readFileSync('/p/a.js');",
    "import { openSync } from 'node:fs'; openSync('/p/a.js'); openSync('/p/a.js', 'r'); openSync('/p/a.js', flags);",
    "import { writeFileSync } from './mine.js'; writeFileSync('/p/a.js', text);",
    "export {}; function writeFileSync() {} writeFileSync('/p/a.js', text);",
    "export {}; other.writeFileSync('/p/a.js', text);",
    "export {}; const Bun = other; Bun.write('/p/a.js', text);",
    "import { writeFileSync } from 'node:fs'; if (false) writeFileSync('/p/a.js', text);",
    "import { writeFileSync } from 'node:fs'; writeFileSync(...all);",
    "export {}; other.file('/p/a.js').write(text);",
];

fn describe_paths_of_changed_files(text: &str) -> Vec<String> {
    let mut described = Vec::new();
    with_workspace(|w| {
        let s = &w.analyze(&Source::new("a.mjs", text), &w.fold_inputs(&TARGET));
        let paths = s.analysis.paths_of_changed_files.iter();
        described = paths
            .flat_map(|(_, specifier)| describe_specifier(s, specifier))
            .collect();
    });
    described
}

#[test]
fn paths_that_a_file_spells_to_calls_which_change_what_is_there() {
    for &(text, paths) in PATHS_OF_CHANGED_FILES {
        assert_eq!(describe_paths_of_changed_files(text), paths, "{text}");
    }
    for &text in CALLS_THAT_CHANGE_NO_FILE_THAT_IS_KNOWN {
        assert!(describe_paths_of_changed_files(text).is_empty(), "{text}");
    }
}

#[test]
fn name_that_a_loop_takes_out_of_an_object_is_known_by_its_start_and_end() {
    let text = "for (const name in table) require(`./lib/${name}.js`);";
    with_last_site(text, |s, site| {
        assert_eq!(describe_alternatives(s, site), ["./lib/*.js"], "{text}");
    });
}

const NAMES_OF_THE_FILE: Fold<'static> = Fold {
    defines: &[
        (Path::Global(&["LOAD"]), Defined::GlobalPath(&["load"])),
        (
            Path::Global(&["process", "env", "LOAD"]),
            Defined::GlobalPath(&["load"]),
        ),
        (
            Path::Global(&["CALL"]),
            Defined::GlobalPath(&["load", "call"]),
        ),
        (Path::Global(&["SELF"]), Defined::GlobalPath(&["inner"])),
        (Path::Global(&["LIST"]), Defined::GlobalPath(&["names"])),
        (
            Path::Global(&["PUSH"]),
            Defined::GlobalPath(&["names", "push"]),
        ),
        (
            Path::Global(&["LIB"]),
            Defined::GlobalPath(&["paths", "lib"]),
        ),
        (
            Path::Global(&["OPT"]),
            Defined::GlobalPath(&["opts", "name"]),
        ),
    ],
    ..Fold::NONE
};

/// The value of the define is the name alone: the function is called there, or the list is pushed to, as where the name is spelled.
const NAMES_BEHIND_A_DEFINE_THAT_IS_A_NAME: &[(&str, &[&str])] = &[
    (
        "function load(name) { return require(name); } LOAD('./a');",
        &["./a"],
    ),
    (
        "function load(name) { return require(name); } LOAD('./a'); load('./b');",
        &["./a", "./b"],
    ),
    (
        "function load(name) { return require(name); } process.env.LOAD('./a');",
        &["./a"],
    ),
    (
        "const names = ['./a']; LIST.push('./b'); for (const name of names) require(name);",
        &["./a", "./b"],
    ),
    (
        "const names = ['.']; LIST.push('lib'); names.push('a.js'); require(names.join('/'));",
        &[".", "./a.js", "./lib", "./lib/a.js"],
    ),
    (
        "const names = ['.']; names.push('lib'); LIST.push('a.js'); require(names.join('/'));",
        &[".", "./a.js", "./lib", "./lib/a.js"],
    ),
];

/// The value of the define is a member of what a variable holds: the member is read, or the list is pushed to, as where the path is spelled.
const NAMES_BEHIND_A_DEFINE_THAT_IS_A_MEMBER: &[(&str, &[&str])] = &[
    (
        "const names = ['./a']; PUSH('./b'); for (const name of names) require(name);",
        &["./a", "./b"],
    ),
    (
        "const names = ['.']; PUSH('lib'); names.push('a.js'); require(names.join('/'));",
        &[".", "./a.js", "./lib", "./lib/a.js"],
    ),
    (
        "const names = ['.']; names.push('lib'); PUSH('a.js'); require(names.join('/'));",
        &[".", "./a.js", "./lib", "./lib/a.js"],
    ),
    ("const paths = { lib: './a' }; require(LIB);", &["./a"]),
    (
        "function load(opts) { return require(OPT); } load({ name: './a' });",
        &["./a"],
    ),
];

/// The value of the define hands the function, the list or the object to code that nobody follows.
const NAMES_BEHIND_A_DEFINE_THAT_ARE_NOT_FOLLOWED: &[&str] = &[
    "function load(name) { return require(name); } const held = LOAD; held('./a');",
    "function load(name) { return require(name); } CALL(null, './a');",
    "const load = function inner(name, again) { return again ? require(name) : SELF('./a', true); }; load('./b');",
    "const names = ['./a']; change(LIST); for (const name of names) require(name);",
    "const paths = { lib: './a' }; change(paths); require(LIB);",
];

fn with_last_site_behind_a_define(
    text: &str,
    test: impl for<'s> FnOnce(&Analyzed<'s>, &ImportSite) + Send,
) {
    with_workspace(|w| {
        let inputs = w.fold_inputs(&NAMES_OF_THE_FILE);
        let s = w.analyze(&Source::new("a.cjs", text), &inputs);
        let site = s.analysis.import_sites.last();
        test(&s, site.unwrap_or_else(|| panic!("{text}: no import site")));
    });
}

#[test]
fn name_of_the_file_that_a_define_spells_is_followed_as_the_name_is() {
    let followed = NAMES_BEHIND_A_DEFINE_THAT_IS_A_NAME.iter();
    for &(text, names) in followed.chain(NAMES_BEHIND_A_DEFINE_THAT_IS_A_MEMBER) {
        with_last_site_behind_a_define(text, |s, site| {
            assert_eq!(describe_alternatives(s, site), names, "{text}");
        });
    }
    for &text in NAMES_BEHIND_A_DEFINE_THAT_ARE_NOT_FOLLOWED {
        with_last_site_behind_a_define(text, |_, site| {
            assert_eq!(site.specifier, ImportSpecifier::Unknown, "{text}");
        });
    }
}

const NAMES_OF_AN_IMPORT: Fold<'static> = Fold {
    defines: &[
        (
            Path::Global(&["LIB"]),
            Defined::GlobalPath(&["paths", "lib"]),
        ),
        (Path::Global(&["ONE"]), Defined::GlobalPath(&["lib"])),
        (Path::Global(&["ALL"]), Defined::GlobalPath(&["paths"])),
    ],
    ..Fold::NONE
};

/// The text, and the export and the member that it reads of the file behind its import where a define names the import. `""`: none.
const NAMES_BEHIND_A_DEFINE_BELOW_AN_IMPORT: &[(&str, &str, &str)] = &[
    ("import * as paths from './paths'; import(LIB);", "", "lib"),
    (
        "import * as paths from './paths'; const name = LIB; import(name);",
        "",
        "lib",
    ),
    (
        "import * as paths from './paths'; import(LIB + '');",
        "",
        "lib",
    ),
    (
        "import * as paths from './paths'; import(ALL.lib);",
        "",
        "lib",
    ),
    ("import { lib } from './paths'; import(ONE);", "lib", ""),
    (
        "import { lib } from './paths'; function load(name) { return import(name); } load(ONE);",
        "lib",
        "",
    ),
];

#[test]
fn constant_of_another_file_is_read_where_a_define_names_its_import() {
    for &(text, export, member) in NAMES_BEHIND_A_DEFINE_BELOW_AN_IMPORT {
        with_workspace(|w| {
            let inputs = w.fold_inputs(&NAMES_OF_AN_IMPORT);
            let source = Source::new("a.mjs", text);
            let atom = |name: &str| match name {
                "" => Atom::NONE,
                name => w.atom(name),
            };
            let name = ImportedName {
                import: ImportId(0),
                export: atom(export),
                member: atom(member),
            };
            let asked = w.analyze(&source, &inputs);
            assert!(asked.analysis.imported_names.contains(&name), "{text}");
            let mut hir = w.parse(&source);
            let given = ImportedConstant {
                name,
                value: Constant::String(w.atom("./a")),
            };
            hir.imported_constants = ArenaFew::from_iter_in([given].into_iter(), w.arena);
            let (bound, analysis) = w.analyze_tree(&mut hir, &source, &inputs, &[]);
            let s = Analyzed {
                workspace: *w,
                hir,
                bound,
                analysis,
            };
            let site = s.analysis.import_sites.last();
            let site = site.unwrap_or_else(|| panic!("{text}: no import site"));
            assert_eq!(describe_alternatives(&s, site), ["./a"], "{text}");
        });
    }
}

const FOLDER_OF_THE_MODULE_IS_A_MEMBER: Fold<'static> = Fold {
    defines: &[(
        Path::ImportMeta(&["dir"]),
        Defined::GlobalPath(&["cfg", "dir"]),
    )],
    ..Fold::NONE
};

const FOLDER_OF_THE_MODULE_IS_A_NAME: Fold<'static> = Fold {
    defines: &[(Path::ImportMeta(&["dir"]), Defined::GlobalPath(&["dir"]))],
    ..Fold::NONE
};

const URL_OF_THE_MODULE_IS_A_MEMBER: Fold<'static> = Fold {
    defines: &[(
        Path::ImportMeta(&["url"]),
        Defined::GlobalPath(&["cfg", "base"]),
    )],
    ..Fold::NONE
};

/// A define puts a path where the text spells the folder or the URL of the module: the path is followed, and the text names nothing.
const NAMES_BEHIND_A_DEFINE_OF_WHAT_THE_MODULE_SAYS_OF_ITSELF: &[(Fold<'static>, &str)] = &[
    (
        FOLDER_OF_THE_MODULE_IS_A_MEMBER,
        "const cfg = { dir: import.meta.dirname + '/sub' }; import(import.meta.dir + '/lib.js');",
    ),
    (
        FOLDER_OF_THE_MODULE_IS_A_NAME,
        "const dir = import.meta.dirname + '/sub'; import(import.meta.dir + '/lib.js');",
    ),
    (
        URL_OF_THE_MODULE_IS_A_MEMBER,
        "const cfg = { base: import.meta.resolve('./sub/x.js') }; import(new URL('./lib.js', import.meta.url));",
    ),
];

#[test]
fn path_of_a_define_is_followed_where_the_text_spells_the_folder_or_the_url_of_the_module() {
    for &(fold, text) in NAMES_BEHIND_A_DEFINE_OF_WHAT_THE_MODULE_SAYS_OF_ITSELF {
        with_workspace(|w| {
            let inputs = w.fold_inputs(&fold);
            let s = w.analyze(&Source::new("a.mjs", text), &inputs);
            let site = s.analysis.import_sites.last();
            let site = site.unwrap_or_else(|| panic!("{text}: no import site"));
            assert_eq!(describe_alternatives(&s, site), ["./sub/lib.js"], "{text}");
        });
    }
}

const LOADERS_OF_THE_FILE: Fold<'static> = Fold {
    defines: &[
        (Path::Global(&["REQ"]), Defined::GlobalPath(&["require"])),
        (Path::Global(&["MADE"]), Defined::GlobalPath(&["made"])),
        (
            Path::Global(&["CR"]),
            Defined::GlobalPath(&["createRequire"]),
        ),
        (Path::Global(&["M"]), Defined::GlobalPath(&["m"])),
        (
            Path::Global(&["MCR"]),
            Defined::GlobalPath(&["m", "createRequire"]),
        ),
        (Path::Global(&["PROC"]), Defined::GlobalPath(&["proc"])),
        (
            Path::Global(&["GBM"]),
            Defined::GlobalPath(&["proc", "getBuiltinModule"]),
        ),
        (
            Path::Global(&["PGBM"]),
            Defined::GlobalPath(&["process", "getBuiltinModule"]),
        ),
        (
            Path::Global(&["HERE"]),
            Defined::GlobalPath(&["__filename"]),
        ),
        (Path::Global(&["LOADER"]), Defined::GlobalPath(&["load"])),
        (
            Path::Global(&["CALL"]),
            Defined::GlobalPath(&["require", "call"]),
        ),
        (Path::Global(&["LIST"]), Defined::GlobalPath(&["names"])),
        (Path::Global(&["DIR"]), Defined::GlobalPath(&["__dirname"])),
        (Path::Global(&["PATH"]), Defined::GlobalPath(&["path"])),
    ],
    ..Fold::NONE
};

/// The define's value is one name, or the path of a `createRequire`: a call there, or of what it makes or fills, loads what the spelled text loads.
const REQUIRES_BEHIND_A_DEFINE: &[(&str, &str, &[&str])] = &[
    ("a.cjs", r#"const load = REQ; load("a");"#, &["a"]),
    (
        "a.cjs",
        r#"REQ.call(null, "a"); REQ.apply(null, ["b"]);"#,
        &["a", "b"],
    ),
    (
        "a.cjs",
        r#"const load = typeof REQ === "function" ? REQ : require; load("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const load = typeof REQ === "function" ? REQ : null; load("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"(function (load) { LOADER("a"); })(require);"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"(function (load) { LOADER(require); })(function (r) { r("a"); });"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; const made = createRequire(import.meta.url); MADE("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; const load = CR(import.meta.url); load("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import m from "node:module"; const load = M.createRequire(import.meta.url); load("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import m from "node:module"; const load = MCR(import.meta.url); load("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"const { createRequire } = require("module"); const load = createRequire(HERE); load("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"const load = REQ; const { createRequire } = load("module"); const made = createRequire(__filename); made("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"REQ.call(null, "module").createRequire(__filename)("a");"#,
        &["module", "a"],
    ),
    (
        "a.mjs",
        r#"const { createRequire } = process.getBuiltinModule("node:module"); const load = CR(import.meta.url); load("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const m = process.getBuiltinModule("node:module"); const { createRequire } = M; const load = createRequire(import.meta.url); load("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const proc = process; const { createRequire } = PROC.getBuiltinModule("node:module"); createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"const proc = process; const { createRequire } = GBM("node:module"); createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import process from "node:process"; const { createRequire } = PGBM("node:module"); createRequire(import.meta.url)("a");"#,
        &["a"],
    ),
    // The lowering tests the receiver of `call`, and a path in place of the callee has none: the build stops at this call.
    ("a.cjs", r#"CALL(null, "a");"#, &[]),
];

/// The one name that a define puts where a file is named is followed as where the name is spelled.
const NAMES_OF_FILES_BEHIND_A_DEFINE: &[(&str, &[&str])] = &[
    (
        "const names = ['./a', './b']; for (const name of LIST) require(name);",
        &["./a", "./b"],
    ),
    (
        "const name = c ? 'a' : 'b'; require(`${DIR}/lib/${name}.js`);",
        &["./lib/a.js", "./lib/b.js"],
    ),
    (
        "const path = c ? './a' : './b'; require(PATH);",
        &["./a", "./b"],
    ),
    (
        "function load(path) { return require(PATH); } load('./a'); load('./b');",
        &["./a", "./b"],
    ),
    (
        "const path = require('path'); const name = c ? 'a' : 'b'; require(PATH.join(__dirname, 'lib', name + '.js'));",
        &["./lib/a.js", "./lib/b.js"],
    ),
];

const REQUIRE_OF_THE_FILE: Fold<'static> = Fold {
    defines: &[(Path::Global(&["require"]), Defined::GlobalPath(&["load"]))],
    ..Fold::NONE
};

const REQUIRE_BELOW_A_VARIABLE: Fold<'static> = Fold {
    defines: &[(
        Path::Global(&["require"]),
        Defined::GlobalPath(&["loader", "load"]),
    )],
    ..Fold::NONE
};

const FUNCTION_IN_PLACE_OF_A_MEMBER_THAT_LOADS: Fold<'static> = Fold {
    defines: &[
        (
            Path::ImportMeta(&["require"]),
            Defined::GlobalPath(&["load"]),
        ),
        (
            Path::ImportMeta(&["resolve"]),
            Defined::GlobalPath(&["load"]),
        ),
        (
            Path::Global(&["require", "resolve"]),
            Defined::GlobalPath(&["load"]),
        ),
        (
            Path::Global(&["process", "getBuiltinModule"]),
            Defined::GlobalPath(&["load"]),
        ),
    ],
    ..Fold::NONE
};

/// Where the text spells `require` or a member that loads, what a define names there is called: no file is loaded or resolved.
const TEXTS_WITHOUT_THE_REQUIRE_OF_THE_FILE: &[(Fold<'static>, &str, &str)] = &[
    (
        REQUIRE_OF_THE_FILE,
        "a.cjs",
        r#"function load(name) { return name; } require("a");"#,
    ),
    (
        REQUIRE_OF_THE_FILE,
        "a.mjs",
        r#"function load(name) { return { createRequire: () => load }; } const { createRequire } = require("node:module"); const made = createRequire(import.meta.url); made("a");"#,
    ),
    (
        REQUIRE_BELOW_A_VARIABLE,
        "a.cjs",
        r#"const loader = { load(name) { return name; } }; require("a");"#,
    ),
    (
        FUNCTION_IN_PLACE_OF_A_MEMBER_THAT_LOADS,
        "a.mjs",
        r#"function load(name) { return name; } import.meta.require("a"); import.meta.resolve("b"); process.getBuiltinModule("node:fs");"#,
    ),
    (
        FUNCTION_IN_PLACE_OF_A_MEMBER_THAT_LOADS,
        "a.cjs",
        r#"function load(name) { return name; } require.resolve("a");"#,
    ),
];

#[test]
fn loader_that_a_define_names_is_followed_as_the_spelled_name_is() {
    for &(path, text, specifiers) in REQUIRES_BEHIND_A_DEFINE {
        with_workspace(|w| {
            let inputs = w.fold_inputs(&LOADERS_OF_THE_FILE);
            let s = w.analyze(&Source::new(path, text), &inputs);
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
    for &(text, names) in NAMES_OF_FILES_BEHIND_A_DEFINE {
        with_workspace(|w| {
            let inputs = w.fold_inputs(&LOADERS_OF_THE_FILE);
            let s = w.analyze(&Source::new("a.cjs", text), &inputs);
            let site = s.analysis.import_sites.last();
            let site = site.unwrap_or_else(|| panic!("{text}: no import site"));
            assert_eq!(describe_alternatives(&s, site), names, "{text}");
        });
    }
    for &(fold, path, text) in TEXTS_WITHOUT_THE_REQUIRE_OF_THE_FILE {
        with_workspace(|w| {
            let inputs = w.fold_inputs(&fold);
            let s = w.analyze(&Source::new(path, text), &inputs);
            assert!(s.analysis.import_sites.is_empty(), "{text}");
        });
    }
}

#[test]
fn binding_that_holds_import_meta_require_is_followed_where_a_define_names_it() {
    with_workspace(|w| {
        let inputs = w.fold_inputs(&LOADERS_OF_THE_FILE);
        let text = r#"const made = import.meta.require; MADE("a"); const same = MADE; same("b");"#;
        let s = w.analyze(&Source::new("a.mjs", text), &inputs);
        let sites = s.analysis.import_sites.iter();
        let required = sites.filter_map(|site| match (site.kind, site.specifier) {
            (ImportSiteKind::ImportMetaRequire(_), ImportSpecifier::Constant(name)) => {
                Some(s.workspace.text(name))
            }
            _ => None,
        });
        assert_eq!(required.collect::<Vec<&str>>(), ["a", "b"], "{text}");
    });
}

const FUNCTION_IN_PLACE_OF_REQUIRE: Fold<'static> = Fold {
    defines: &[
        (Path::Global(&["require"]), Defined::GlobalPath(&["load"])),
        (
            Path::Global(&["process", "platform"]),
            Defined::Value(Data::String("linux")),
        ),
    ],
    ..Fold::NONE
};

/// (defines, file, text, what the last import site may name). The text asks a loader for a module, and a define puts a function of the file there.
const NAMES_BEHIND_A_FUNCTION_IN_PLACE_OF_A_LOADER: &[(Fold<'static>, &str, &str, &[&str])] = &[
    (
        FUNCTION_IN_PLACE_OF_REQUIRE,
        "a.mjs",
        "function load() { return { fileURLToPath: () => './b.js' }; } const { fileURLToPath } = require('url'); import(fileURLToPath(new URL('./a.js', import.meta.url)));",
        &["./b.js"],
    ),
    (
        FUNCTION_IN_PLACE_OF_REQUIRE,
        "a.mjs",
        "function load() { return { fileURLToPath: () => './b.js' }; } const { fileURLToPath } = require('node:' + 'url'); import(fileURLToPath(new URL('./a.js', import.meta.url)));",
        &["./b.js"],
    ),
    (
        FUNCTION_IN_PLACE_OF_REQUIRE,
        "a.mjs",
        "function load() { return { fileURLToPath: () => x }; } import(require('url').fileURLToPath(import.meta.resolve('./a.js')));",
        &[],
    ),
    (
        FUNCTION_IN_PLACE_OF_REQUIRE,
        "a.cjs",
        "function load() { return { platform: () => 'other' }; } const os = require('node:os'); module.require('./lib/' + os.platform() + '.js');",
        &["./lib/*.js"],
    ),
    (
        FUNCTION_IN_PLACE_OF_REQUIRE,
        "a.cjs",
        "function load() {} const name = c ? 'a' : 'b'; module.require(require.resolve('./lib/' + name + '.js'));",
        &[],
    ),
    (
        FUNCTION_IN_PLACE_OF_REQUIRE,
        "a.cjs",
        "function load() {} const names = ['./a', './b']; require(names); for (const name of names) module.require(name);",
        &[],
    ),
    (
        FUNCTION_IN_PLACE_OF_A_MEMBER_THAT_LOADS,
        "a.mjs",
        "function load() { return { fileURLToPath: () => './b.js' }; } import(import.meta.require('url').fileURLToPath(new URL('./a.js', import.meta.url)));",
        &["./b.js"],
    ),
    (
        FUNCTION_IN_PLACE_OF_A_MEMBER_THAT_LOADS,
        "a.mjs",
        "function load() { return { fileURLToPath: () => './b.js' }; } import(process.getBuiltinModule('url').fileURLToPath(new URL('./a.js', import.meta.url)));",
        &["./b.js"],
    ),
    (
        FUNCTION_IN_PLACE_OF_A_MEMBER_THAT_LOADS,
        "a.mjs",
        "function load() {} const name = c ? 'a' : 'b'; import(import.meta.resolve('./lib/' + name + '.js'));",
        &[],
    ),
];

#[test]
fn answer_of_a_function_that_a_define_puts_in_place_of_a_loader_is_no_module() {
    for &(fold, path, text, names) in NAMES_BEHIND_A_FUNCTION_IN_PLACE_OF_A_LOADER {
        with_workspace(|w| {
            let inputs = w.fold_inputs(&fold);
            let s = w.analyze(&Source::new(path, text), &inputs);
            let site = s.analysis.import_sites.last();
            let site = site.unwrap_or_else(|| panic!("{text}: no import site"));
            assert_eq!(describe_alternatives(&s, site), names, "{text}");
        });
    }
    with_workspace(|w| {
        let inputs = w.fold_inputs(&FUNCTION_IN_PLACE_OF_REQUIRE);
        let text = r#"function load() { return { _cache: {} }; } const key = c ? "./a.js" : "./b.js"; require("module")._cache[key] = entry;"#;
        let s = w.analyze(&Source::new("a.cjs", text), &inputs);
        assert_eq!(describe_keys_stored_in_caches(&s), [""; 0], "{text}");
        let text =
            "function load() { return { unlinkSync() {} }; } require('fs').unlinkSync('/p/a.js');";
        let s = w.analyze(&Source::new("a.cjs", text), &inputs);
        assert!(s.analysis.paths_of_changed_files.is_empty(), "{text}");
    });
}

const ROUTES_OF_THE_FILE: Fold<'static> = Fold {
    defines: &[
        (Path::Global(&["REQ"]), Defined::GlobalPath(&["require"])),
        (Path::Global(&["MOD"]), Defined::GlobalPath(&["module"])),
        (Path::Global(&["FILE"]), Defined::GlobalPath(&["file"])),
        (
            Path::Global(&["TO_PATH"]),
            Defined::GlobalPath(&["fileURLToPath"]),
        ),
        (Path::Global(&["PATH"]), Defined::GlobalPath(&["path"])),
        (
            Path::Global(&["HERE"]),
            Defined::GlobalPath(&["__filename"]),
        ),
        (Path::Global(&["HELD"]), Defined::GlobalPath(&["held"])),
        (Path::Global(&["W"]), Defined::GlobalPath(&["Worker"])),
        (
            Path::Global(&["LOAD"]),
            Defined::GlobalPath(&["module", "require"]),
        ),
        (Path::Global(&["FS"]), Defined::GlobalPath(&["fs"])),
        (
            Path::Global(&["PUT"]),
            Defined::GlobalPath(&["writeFileSync"]),
        ),
        (
            Path::Global(&["PUT2"]),
            Defined::GlobalPath(&["fs", "writeFileSync"]),
        ),
        (Path::Global(&["MOCK"]), Defined::GlobalPath(&["mock"])),
        (Path::Global(&["MODULE"]), Defined::GlobalPath(&["Module"])),
        (
            Path::Global(&["CACHE"]),
            Defined::GlobalPath(&["require", "cache"]),
        ),
    ],
    ..Fold::NONE
};

/// The finder follows each text where its names are spelled. Here a define puts a name of it, or the path `module.require`.
const REQUIRES_BY_A_ROUTE_BEHIND_A_DEFINE: &[(&str, &str, &[&str])] = &[
    ("a.cjs", r#"(0, REQ)("a"); (c && REQ)("b");"#, &["a", "b"]),
    ("a.cjs", r#"const load = MOD.require; load("a");"#, &["a"]),
    (
        "a.cjs",
        r#"const load = MOD && MOD.require; load.call(MOD, "a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"(0, LOAD)("a"); LOAD.call(module, "b"); const load = LOAD; load("c");"#,
        &["a", "b", "c"],
    ),
    ("a.cjs", r#"LOAD("a"); MOD.require("b");"#, &["a", "b"]),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; import { fileURLToPath } from "node:url"; const file = fileURLToPath(import.meta.url); createRequire(FILE)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; import { fileURLToPath } from "node:url"; createRequire(TO_PATH(import.meta.url))("a");"#,
        &["a"],
    ),
];

fn analyzed_with_routes_behind_defines(
    path: &str,
    text: &str,
    test: impl for<'s> FnOnce(&Analyzed<'s>) + Send,
) {
    with_workspace(|w| {
        let inputs = w.fold_inputs(&ROUTES_OF_THE_FILE);
        test(&w.analyze(&Source::new(path, text), &inputs));
    });
}

#[test]
fn route_to_a_loader_is_followed_where_a_define_puts_a_name_on_it() {
    for &(path, text, specifiers) in REQUIRES_BY_A_ROUTE_BEHIND_A_DEFINE {
        analyzed_with_routes_behind_defines(path, text, |s| {
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

#[test]
fn own_folder_is_known_where_defines_name_the_module_of_paths_and_the_file() {
    let text = "const path = require('path'); const name = c ? 'a' : 'b'; require(PATH.join(PATH.dirname(HERE), 'lib', name + '.js'));";
    analyzed_with_routes_behind_defines("a.cjs", text, |s| {
        let site = s.analysis.import_sites.last();
        let site = site.unwrap_or_else(|| panic!("{text}: no import site"));
        let names = ["./lib/a.js", "./lib/b.js"];
        assert_eq!(describe_alternatives(s, site), names, "{text}");
    });
}

/// The table is `require.cache` or the `_cache` of the module `module`. A define names the object that has it, or the path `require.cache`.
const STORES_TO_THE_CACHE_BEHIND_A_DEFINE: &[&str] = &[
    r#"const key = c ? "./a.js" : "./b.js"; REQ.cache[key] = entry;"#,
    r#"const key = c ? "./a.js" : "./b.js"; CACHE[key] = entry;"#,
    r#"const Module = require("module"); const key = c ? "./a.js" : "./b.js"; MODULE._cache[key] = entry;"#,
];

fn describe_keys_stored_in_caches(s: &Analyzed<'_>) -> Vec<String> {
    let entries = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::Index { .. }));
    let keys = entries
        .into_iter()
        .filter_map(|entry| match s.hir.member_key(entry) {
            Some((_, MemberKey::Computed(key))) => s.analysis.find_key_stored_in_cache(key),
            _ => None,
        });
    keys.flat_map(|key| describe_specifier(s, key)).collect()
}

#[test]
fn key_stored_in_the_cache_of_a_require_that_a_define_names_is_known() {
    for &text in STORES_TO_THE_CACHE_BEHIND_A_DEFINE {
        analyzed_with_routes_behind_defines("a.cjs", text, |s| {
            let described = describe_keys_stored_in_caches(s);
            assert_eq!(described, ["./a.js", "./b.js"], "{text}");
        });
    }
}

/// The function that changes the file is read off `Bun` or off a module of files. A define puts a name on the way to it, or the path of the function.
const PATHS_OF_FILES_CHANGED_BEHIND_A_DEFINE: &[(&str, &str, &[&str])] = &[
    (
        "a.mjs",
        "export {}; const held = Bun; await HELD.write('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; FS.writeFileSync('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; await FS.promises.writeFile('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; FS.renameSync('/p/a.js', '/p/b.js');",
        &["/p/a.js", "/p/b.js"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; const same = FS; same.writeFileSync('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "a.mjs",
        "import { writeFileSync } from 'node:fs'; PUT('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; PUT2('/p/a.js', text);",
        &["/p/a.js"],
    ),
    (
        "a.cjs",
        "const fs = require('fs'); FS.unlinkSync('/p/a.js');",
        &["/p/a.js"],
    ),
];

#[test]
fn path_of_a_file_that_a_call_on_a_defined_name_changes_is_known() {
    for &(path, text, paths) in PATHS_OF_FILES_CHANGED_BEHIND_A_DEFINE {
        analyzed_with_routes_behind_defines(path, text, |s| {
            let changed = s.analysis.paths_of_changed_files.iter();
            let described: Vec<String> = changed
                .flat_map(|(_, specifier)| describe_specifier(s, specifier))
                .collect();
            assert_eq!(described, paths, "{text}");
        });
    }
}

#[test]
fn mock_of_a_module_is_a_site_where_a_define_names_the_mock_of_the_test_runner() {
    let text = r#"import { mock } from "bun:test"; MOCK.module("./a", f);"#;
    analyzed_with_routes_behind_defines("a.mjs", text, |s| {
        let sites = s.analysis.import_sites.iter();
        let mocked = sites.filter_map(|site| match (site.kind, site.specifier) {
            (ImportSiteKind::MockModule(_), ImportSpecifier::Constant(name)) => {
                Some(s.workspace.text(name))
            }
            _ => None,
        });
        assert_eq!(mocked.collect::<Vec<&str>>(), ["./a"], "{text}");
    });
}

/// `Worker` is what the file takes out of `node:worker_threads`, or the global.
const WORKERS_BEHIND_A_DEFINE: &[&str] = &[
    "const { Worker } = require('node:worker_threads'); new W('./a/' + x + '.js', options);",
    "new W('./a/' + x + '.js');",
];

#[test]
fn name_of_a_worker_is_known_in_part_where_a_define_names_its_constructor() {
    for &text in WORKERS_BEHIND_A_DEFINE {
        analyzed_with_routes_behind_defines("a.cjs", text, |s| {
            let constructions = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::New(_)));
            let names = constructions.into_iter().filter_map(|construction| {
                let ExprKind::New(call) = s.hir[construction].kind else {
                    return None;
                };
                let argument = s.hir.ids(s.hir[call].args).next()?;
                s.analysis.find_name_of_worker(argument)
            });
            let described: Vec<String> =
                names.flat_map(|name| describe_specifier(s, name)).collect();
            assert_eq!(described, ["./a/*.js"], "{text}");
        });
    }
}
