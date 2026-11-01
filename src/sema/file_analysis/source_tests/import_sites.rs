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
    (
        "a.cjs",
        r#"var m = require("module"); var load = (0, m.createRequire)(__filename); load("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire.call(void 0, __filename); load("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = (0, m.createRequire).call(null, __filename); load("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire.call(__filename); load("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire.call(...list, __filename); load("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire.apply(void 0, __filename); load("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.other.call(void 0, __filename); load("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(new URL("file:" + __filename).href)("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(new URL("file://" + __filename))("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire("file://" + __filename)("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"const url = new URL("file:" + __filename); const text = url.href; require("module").createRequire(text)("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(require("url").pathToFileURL(__filename))("a");"#,
        &["module", "url", "a"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(require("node:url").pathToFileURL(__filename).href)("a");"#,
        &["module", "node:url", "a"],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "module"; createRequire(new URL(import.meta.url).href)("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "module"; import { pathToFileURL } from "url"; createRequire(pathToFileURL(import.meta.filename))("a");"#,
        &["a"],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "module"; import { pathToFileURL } from "url"; createRequire(pathToFileURL(import.meta.url))("a");"#,
        &[],
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "module"; createRequire("file://" + import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire("file://" + new URL("file:" + __filename).href)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire("http://" + __filename)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__filename + "file:")("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__filename.href)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(new URL("file:" + __filename).pathname)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(new Other("file:" + __filename).href)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(require("./url").pathToFileURL(__filename))("a");"#,
        &["module", "./url"],
    ),
    (
        "a.cjs",
        r#"var url = () => typeof document === "undefined" ? new URL("file:" + __filename).href : document.currentScript && document.currentScript.src || new URL("main.js", document.baseURI).href; var own = url(); var m = require("module"); var load = (0, m.createRequire)(own); load("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire(typeof document === "undefined" ? require("u" + "rl").pathToFileURL(__filename).href : document.baseURI); function f() { return load("a"); }"#,
        &["module", "url", "a"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire(other || __filename); var again = load; again("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"var url = () => typeof document === "undefined" ? new URL(`file:${__filename}`).href : document.baseURI; var own = url(); var load = require("module").createRequire.call(void 0, own); load("a");"#,
        &["module", "a"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); m.createRequire(other || __filename)("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire(other || elsewhere); load("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire(other || __filename); load = x; load("a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"var m = require("module"); var load = m.createRequire(other || __filename); load.call(null, "a");"#,
        &["module"],
    ),
    (
        "a.cjs",
        r#"var url = given => given || elsewhere; var m = require("module"); var load = m.createRequire(url(x, y)); load("a");"#,
        &["module"],
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
    // What is called may be `require`: the call asks where it runs.
    (
        "a.cjs",
        r#"const load = (flag ? require : other); load("a");"#,
        &["a"],
    ),
    ("a.cjs", r#"(other ?? require)("a");"#, &["a"]),
    ("a.cjs", r#"(require || other)("a");"#, &["a"]),
    (
        "a.cjs",
        r#"(one ?? (two || (flag ? three : require)))("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"(a ?? (b ?? (c ?? (d ?? (e ?? (f ?? (g ?? (h ?? (i ?? (j ?? require))))))))))("a");"#,
        &["a"],
    ),
    ("a.cjs", r#"(one ?? two)("a");"#, &[]),
    // A choice that leads back to itself.
    ("a.cjs", r#"var load = load || require; load("a");"#, &["a"]),
    ("a.cjs", r#"var load = load ?? require; load("a");"#, &["a"]),
    (
        "a.cjs",
        r#"var load = typeof load === "function" ? load : require; load("a");"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"var one = two || require; var two = one || require; one("a"); two("b");"#,
        &["a", "b"],
    ),
    ("a.cjs", r#"var load = load || other; load("a");"#, &[]),
    (
        "a.cjs",
        r#"var one = two || one; var two = one || two; one("a");"#,
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

/// The file, its text, and `(specifier, path)` of what the names of its loads ask of other files.
const ASKED_OF_DATA_FILES: &[(&str, &str, &[(&str, &str)])] = &[
    (
        "a.cjs",
        r#"require(require("./c.json").plugin);"#,
        &[("./c.json", "plugin")],
    ),
    (
        "a.cjs",
        r#"require(require("./c.json").nested.main);"#,
        &[("./c.json", "nested"), ("./c.json", "nested\0main")],
    ),
    (
        "a.cjs",
        r#"const c = require("./c.json"); require(c.list[0]);"#,
        &[("./c.json", "list"), ("./c.json", "list\x000")],
    ),
    (
        "a.cjs",
        r#"const { plugin } = require("./c.json"); require(plugin);"#,
        &[("./c.json", "plugin")],
    ),
    (
        "a.mts",
        r#"import c from "./c.json"; import(c.plugin);"#,
        &[("./c.json", "plugin")],
    ),
    (
        "a.mts",
        r#"import { plugin } from "./c.json"; import(plugin);"#,
        &[("./c.json", "plugin")],
    ),
    (
        "a.mts",
        r#"import * as c from "./c.json"; import(c.default.plugin); import(c.other);"#,
        &[("./c.json", "other"), ("./c.json", "plugin")],
    ),
    // No load is named by it.
    ("a.cjs", r#"console.log(require("./c.json").plugin);"#, &[]),
    // The key is not known.
    ("a.cjs", r#"require(require("./c.json")[key]);"#, &[]),
];

#[test]
fn names_of_loads_ask_for_texts_of_other_files() {
    for &(path, text, expected) in ASKED_OF_DATA_FILES {
        analyzed(path, text, |s| {
            let asked = s.analysis.asked_of_data_files.iter();
            let mut asked: Vec<(&str, &str)> = asked
                .map(|it| (s.workspace.text(it.0), s.workspace.text(it.1)))
                .collect();
            asked.sort_unstable();
            assert_eq!(asked, expected, "{text}");
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

// `None`: no site. `Some(None)`: the name is looked for from the file itself.
const REQUIRES_MADE_FOR_PATHS: &[(&str, &str, Option<Option<&str>>)] = &[
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/")("./a");"#,
        Some(None),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/beside.js")("./a");"#,
        Some(None),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/lib/")("./a");"#,
        Some(Some("./lib/")),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/lib/index.js")("./a");"#,
        Some(Some("./lib/index.js")),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/lib" + "/index.js")("./a");"#,
        Some(Some("./lib/index.js")),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(`${__dirname}/lib/index.js`)("./a");"#,
        Some(Some("./lib/index.js")),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(require("path").join(__dirname, "lib", "index.js"))("./a");"#,
        Some(Some("./lib/index.js")),
    ),
    (
        "a.cjs",
        r#"const base = __dirname + "/lib/"; const load = require("module").createRequire(base); load("./a");"#,
        Some(Some("./lib/")),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/lib/").resolve("./a");"#,
        Some(Some("./lib/")),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/../lib/")("./a");"#,
        Some(Some("./../lib/")),
    ),
    // A path without a slash at its end is a file to `createRequire`, and the folder of this one is the folder above.
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname)("./a");"#,
        Some(Some(".")),
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; createRequire(import.meta.dir + "/lib/")("./a");"#,
        Some(Some("./lib/")),
    ),
    // A whole path is the same to every `require`.
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/lib/")(__dirname + "/a");"#,
        Some(None),
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/lib/..")("./a");"#,
        None,
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + name)("./a");"#,
        None,
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(__dirname + "/" + name + "/")("./a");"#,
        None,
    ),
    (
        "a.cjs",
        r#"require("module").createRequire("x" + __dirname + "/lib/")("./a");"#,
        None,
    ),
    (
        "a.cjs",
        r#"require("module").createRequire(other + "/lib/")("./a");"#,
        None,
    ),
    (
        "a.cjs",
        r#"__dirname = other; require("module").createRequire(__dirname + "/lib/")("./a");"#,
        None,
    ),
    (
        "a.cjs",
        r#"var a = b + "/x", b = a + "/y"; require("module").createRequire(a)("./a");"#,
        None,
    ),
    // What is made is asked for on the way to what it is made of.
    (
        "a.cjs",
        r#"const load = require("module").createRequire(load("path").join(__dirname, "lib", "index.js")); load("./a");"#,
        None,
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const load = createRequire(load("url").fileURLToPath(import.meta.url)); load("./a");"#,
        Some(None),
    ),
];

#[test]
fn call_of_require_made_for_path_from_own_folder_is_resolved_from_that_path() {
    for &(path, text, expected) in REQUIRES_MADE_FOR_PATHS {
        analyzed(path, text, |s| {
            let sites = s.analysis.import_sites.iter().enumerate();
            let found = sites.filter_map(|(index, site)| match site.specifier {
                ImportSpecifier::Constant(name) if s.workspace.text(name) == "./a" => {
                    Some(match s.analysis.path_to_resolve_from(index) {
                        Some(ResolvedFrom::PathFromOwnFolder(path)) => Some(s.workspace.text(path)),
                        Some(ResolvedFrom::File(_)) => Some("a file"),
                        None => None,
                    })
                }
                _ => None,
            });
            assert_eq!(
                found.collect::<Vec<_>>(),
                Vec::from_iter(expected),
                "{text}"
            );
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
        "require(require.resolve('./a', { [Symbol.for('outside')]: true }));",
        ResolvedForm::Path,
        &["./a"],
    ),
    (
        "require(require.resolve('./a', {}));",
        ResolvedForm::Path,
        &["./a"],
    ),
    (
        "require(require.resolve('./a', options));",
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
        "require('file://' + __dirname + '/lib/a.js');",
        ResolvedForm::Url,
        &["./lib/a.js"],
    ),
    (
        "require(`file://${__dirname}/lib/a.js`);",
        ResolvedForm::Url,
        &["./lib/a.js"],
    ),
    (
        "require('file://' + require('path').join(__dirname, 'lib', 'a.js'));",
        ResolvedForm::Url,
        &["./lib/a.js"],
    ),
    (
        "const name = c ? 'a' : 'b'; import('file://' + __dirname + '/lib/' + name + '.js');",
        ResolvedForm::Url,
        &["./lib/a.js", "./lib/b.js"],
    ),
    (
        "import('file://' + __dirname + '/lib/' + x + '.js');",
        ResolvedForm::Url,
        &["./lib/*.js"],
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
    "require('file://' + __dirname + '/a%20b.js');",
    "require('file://' + __dirname + '/a.js?b');",
    "require('file://' + __dirname + '/a.js#b');",
    "require('file://' + 'file://' + __dirname + '/a.js');",
    "require(require('path').join('file://' + __dirname, 'a.js'));",
    "require(require('url').pathToFileURL('file://' + __dirname + '/a.js').href);",
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
        &["/p/a.js and below", "/p/b.js and below"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', { force: true, recursive: true });",
        &["/p/a and below"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', { recursive: false });",
        &["/p/a"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', { force: true });",
        &["/p/a"],
    ),
    (
        "import { rm } from 'node:fs'; rm('/p/a', () => {});",
        &["/p/a"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', { recursive: deep });",
        &["/p/a and below"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', { recursive });",
        &["/p/a and below"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', { ...options });",
        &["/p/a and below"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', { [name]: true });",
        &["/p/a and below"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', options);",
        &["/p/a and below"],
    ),
    (
        "import { rmSync } from 'node:fs'; rmSync('/p/a', ...rest);",
        &["/p/a and below"],
    ),
    (
        "import { cpSync } from 'node:fs'; cpSync('/p/a', '/p/b', { recursive: true });",
        &["/p/b and below"],
    ),
    (
        "import { cpSync } from 'node:fs'; cpSync('/p/a', '/p/b');",
        &["/p/b"],
    ),
    (
        "import { createWriteStream } from 'node:fs'; createWriteStream('', { fd });",
        &[""],
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
    (
        "import { writeFileSync } from 'node:fs'; import { join } from 'node:path'; writeFileSync(join(process.cwd(), 'lib', 'a.js'), text);",
        &["./lib/a.js"],
    ),
    (
        "import { writeFileSync } from 'node:fs'; import { cwd } from 'node:process'; const root = cwd(); writeFileSync(`${root}/a.js`, text);",
        &["./a.js"],
    ),
    (
        "const { writeFileSync } = await import('node:fs'); writeFileSync('/p/a.js', text);",
        &["/p/a.js"],
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
            .flat_map(|changed| {
                let reach = if changed.reaches_below {
                    " and below"
                } else {
                    ""
                };
                let paths = describe_specifier(s, &changed.path).into_iter();
                paths.map(move |path| path + reach)
            })
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

const FUNCTIONS_THAT_CHANGE_THE_FILE_THEY_ARE_TOLD: &[(&str, &str, &[&str])] = &[
    (
        "a.mjs",
        "import { writeFileSync } from 'node:fs'; export const put = (path, text) => writeFileSync(path, text);",
        &["put 0"],
    ),
    (
        "a.mjs",
        "import { rmSync } from 'node:fs'; function clear(options, folder) { rmSync(folder, { recursive: true }); } export { clear, clear as empty };",
        &["clear 1 and below", "empty 1 and below"],
    ),
    (
        "a.mjs",
        "import { writeFileSync } from 'node:fs'; export default function (path, text) { writeFileSync(path, text); }",
        &["default 0"],
    ),
    (
        "a.cjs",
        "const { writeFileSync } = require('node:fs'); exports.put = function (path, text) { writeFileSync(path, text); };",
        &["put 0"],
    ),
    (
        "a.mjs",
        "import { writeFileSync } from 'node:fs'; const put = (path, text) => writeFileSync(path, text);",
        &[],
    ),
    (
        "a.mjs",
        "import { writeFileSync } from 'node:fs'; export const put = (path, text) => { path = other; writeFileSync(path, text); };",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; export const read = path => readFileSync(path);",
        &[],
    ),
];

#[test]
fn functions_that_a_file_exports_and_that_change_the_file_they_are_told() {
    for &(name, text, functions) in FUNCTIONS_THAT_CHANGE_THE_FILE_THEY_ARE_TOLD {
        with_workspace(|w| {
            let s = &w.analyze(&Source::new(name, text), &w.fold_inputs(&TARGET));
            let mut described: Vec<String> = (s.analysis.exported_file_changers.iter())
                .map(|it| {
                    let reach = if it.reaches_below { " and below" } else { "" };
                    format!("{} {}{reach}", s.workspace.text(it.export), it.place)
                })
                .collect();
            described.sort();
            assert_eq!(described, functions, "{text}");
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
