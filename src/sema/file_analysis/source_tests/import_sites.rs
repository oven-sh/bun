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
        "a.cjs",
        r#"let aliased; function load() { try { aliased = require; aliased("a"); } catch {} } load();"#,
        &["a"],
    ),
    ("a.cjs", r#"with (scope) { require("a"); }"#, &["a"]),
    (
        "a.cjs",
        r#"function load(require) { with (scope) { require("a"); } }"#,
        &[],
    ),
    (
        "a.cjs",
        r#"var aliased; aliased = require; aliased = other; aliased("a");"#,
        &[],
    ),
    (
        "a.cjs",
        r#"for (let load of others) { load("a"); load = require; }"#,
        &[],
    ),
    (
        "a.cjs",
        r#"for (var load in others) { load("a"); load = require; }"#,
        &[],
    ),
    (
        "a.cjs",
        r#"for (let load; ; ) { load = require; load("a"); break; }"#,
        &["a"],
    ),
    (
        "a.cjs",
        r#"try { run(); } catch (load) { load("a"); load = require; }"#,
        &[],
    ),
    (
        "a.cjs",
        r#"function take(load) { load("a"); load = require; } take(other);"#,
        &[],
    ),
    (
        "a.cjs",
        r#"const { createRequire } = require("module"); let load = require; load = createRequire(__filename); load("a");"#,
        &["module"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const get = () => createRequire(import.meta.url); get()("a");"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function get() { return createRequire(import.meta.url); } get()("a");"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let get = () => createRequire(import.meta.url); get = other; get()("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const get = async () => createRequire(import.meta.url); get()("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load; function ask() { load ??= createRequire(import.meta.url); return load("a"); } ask();"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load; const get = () => (load ??= createRequire(import.meta.url)); get()("a");"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load; try { load = createRequire(import.meta.url); } catch { load = undefined; } load("a");"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load; try { load = createRequire(import.meta.url); } catch { load = other; } load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load; load = createRequire(import.meta.url); [load] = others; load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; export let load; load = createRequire(import.meta.url); load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load; load = createRequire(import.meta.url); eval(text); load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; let load; load = createRequire(elsewhere); load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const load = typeof createRequire === "function" ? createRequire(import.meta.url) : undefined; load("a");"#,
        &["a"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const load = c ? createRequire(import.meta.url) : other; load("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const load = c ? createRequire(import.meta.url) : null; load?.("a");"#,
        &["a"],
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
        "a.mts",
        r#"import { createRequire } from "node:module"; import.meta.tag`x`; createRequire(import.meta.url)("a");"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; tag`${import.meta.dir}`; createRequire(import.meta.url)("a");"#,
        &["a"],
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
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { const load = createRequire(url); return load("./a.json"); } read(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; const read = (url: string) => createRequire(url)("./a.json"); read(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } read(import.meta.url); read(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } function outer(url: string) { return read(url); } outer(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.cjs",
        r#"const { createRequire } = require("module"); function read(file) { return createRequire(file)("./a.json"); } read(__filename);"#,
        &["module", "./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; export function read(url: string) { return createRequire(url)("./a.json"); } read(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { return createRequire(p.url)("./a.json"); } read({ url: import.meta.url });"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { return createRequire(p.url)("./a.json"); } read({ url: import.meta.url, other: 1 }); read({ url: import.meta.url });"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function h0(url: string) { return createRequire(url)("./a.json"); } function h1(url: string) { return h0(url); } function h2(url: string) { return h1(url); } function h3(url: string) { return h2(url); } function h4(url: string) { return h3(url); } h4(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string, n: number): unknown { return n ? read(url, n - 1) : createRequire(url)("./a.json"); } read(import.meta.url, 1);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function one(url: string): unknown { return two(url) ?? createRequire(url)("./a.json"); } function two(url: string): unknown { return one(url); } one(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } function between(url: string) { return read(url); } function label(p: { url: string }) { return between(p.url); } const LABEL = label({ url: import.meta.url }); export { between as b, label as a, LABEL as t };"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read({ url }: { url: string }) { return createRequire(url)("./a.json"); } read({ url: import.meta.url });"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read({ at: { url } }: { at: { url: string } }) { return createRequire(url)("./a.json"); } read({ at: { url: import.meta.url } });"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function left(url: string) { return read(url); } function right(url: string) { return read(url); } function read(url: string) { return createRequire(url)("./a.json"); } function top(url: string) { return [left(url), right(url)]; } top(import.meta.url);"#,
        &["./a.json"],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } read(import.meta.url); read(other);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { url = other; return createRequire(url)("./a.json"); } read(import.meta.url);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } [import.meta.url].map(read);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string = other) { return createRequire(url)("./a.json"); } read(import.meta.url);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } read(...list);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } "#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string): unknown { return read(url) ?? createRequire(url)("./a.json"); }"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json"); } function outer(url: string) { return read(url); } outer(import.meta.url); outer(other);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { p.url = other; return createRequire(p.url)("./a.json"); } read({ url: import.meta.url });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { change(p); return createRequire(p.url)("./a.json"); } read({ url: import.meta.url });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string; set(): void }) { p.set(); return createRequire(p.url)("./a.json"); } read({ url: import.meta.url, set: change });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url?: string }) { delete p.url; return createRequire(p.url)("./a.json"); } read({ url: import.meta.url });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { return createRequire(p.url)("./a.json"); } read({ url: import.meta.url, ...other });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { return createRequire(p.url)("./a.json"); } read({ url: import.meta.url, ["url"]: other });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { return createRequire(p.url)("./a.json"); } read({ get url() { return import.meta.url; } });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { return createRequire(p.url)("./a.json"); } const given = { url: import.meta.url }; read(given);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(p: { url: string }) { return createRequire(p.url)("./a.json"); } read({ url: import.meta.url }); read({ url: other });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read({ url = other }: { url?: string }) { return createRequire(url)("./a.json"); } read({ url: import.meta.url });"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read({ url }: { url: string }) { return createRequire(url)("./a.json"); } read(given);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.cjs"); } read(import.meta.url);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.ts"); } read(import.meta.url);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("a"); } read(import.meta.url);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("./a.json?raw"); } read(import.meta.url);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("pkg/a.json"); } read(import.meta.url);"#,
        &[],
    ),
    (
        "a.mts",
        r#"import { createRequire } from "node:module"; function read(url: string) { return createRequire(url)("../a.json"); } read(import.meta.url);"#,
        &["../a.json"],
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
    ("a.cjs", r#"function f(require) { require("a"); }"#, &[]),
    ("a.cjs", r#"function require(name) {} require("a");"#, &[]),
    (
        "a.cjs",
        r#"{ class require {} require("a"); require.resolve("a"); }"#,
        &[],
    ),
    (
        "a.cjs",
        r#"function f(module) { module.require("a"); }"#,
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
fn macro_callee_names_template_tag() {
    let text =
        r#"import d, * as m from "./m" with { type: "macro" }; d`a`; m.f`${1}`; m`a`; x`a`;"#;
    analyzed("a.ts", text, |s| {
        let default = s.bound.declared_symbol(Decl::ImportDefault(ImportId(0)));
        let namespace = s.bound.declared_symbol(Decl::ImportNamespace(ImportId(0)));
        let mut macro_symbols = [default, namespace];
        macro_symbols.sort_unstable();
        let templates = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::TaggedTemplate(_)));
        let callees: Vec<Option<(SymbolId, Option<Atom>)>> = templates
            .iter()
            .map(|&template| macro_callee(&s.hir, &s.bound, &macro_symbols, template))
            .collect();
        let member_tag = Some((namespace, Some(s.workspace.atom("f"))));
        assert_eq!(callees, [Some((default, None)), member_tag, None, None]);
        assert_eq!(s.analysis.pending_macro_calls, &templates[..2]);
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
fn alias_by_require_in_a_namespace_is_a_site() {
    for (text, count) in [
        (
            r#"namespace N { import r = require("s"); export const a = r; }"#,
            1,
        ),
        (r#"namespace N { export import r = require("s"); }"#, 1),
        (
            r#"namespace N { namespace M { import r = require("s"); export const a = r; } }"#,
            1,
        ),
        (
            r#"import r = require("s"); namespace N { export const a = r; }"#,
            1,
        ),
        (
            r#"namespace N { import type r = require("s"); export const a = 1; }"#,
            0,
        ),
        (r#"declare namespace N { import r = require("s"); }"#, 0),
    ] {
        analyzed("a.ts", text, |s| {
            let sites = s.analysis.import_sites.iter();
            let aliases = sites.filter(|site| matches!(site.kind, ImportSiteKind::ImportEquals(_)));
            assert_eq!(aliases.count(), count, "{text}");
        });
    }
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
    ("a.cjs", r#"console.log(require("./c.json").plugin);"#, &[]),
    ("a.cjs", r#"require(require("./c.json")[key]);"#, &[]),
];

const ASKED_OF_OWN_EXPORTS: &[(&str, &[&str])] = &[
    (
        "const table = (exports.table = { a: './a' }); require(table[x]);",
        &["table"],
    ),
    (
        "const table = (module.exports.table = { a: './a' }); require(table[x]);",
        &["table"],
    ),
    (
        "const table = (module.exports = { a: './a' }); require(table[x]);",
        &["exports"],
    ),
    (
        "const table = (exports.table = { a: './a' }); this.table.a = other; require(table[x]);",
        &[],
    ),
    ("const table = { a: './a' }; require(table[x]);", &[]),
    ("exports.table = { a: './a' }; require('./a');", &[]),
];

#[test]
fn what_is_followed_through_the_exports_asks_who_else_touches_them() {
    for &(text, expected) in ASKED_OF_OWN_EXPORTS {
        analyzed("a.cjs", text, |s| {
            let asked = s.analysis.asked_of_own_exports.iter();
            let asked: Vec<&str> = asked.map(|&it| s.workspace.text(it)).collect();
            assert_eq!(asked, expected, "{text}");
        });
    }
}

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

const ASKED_WHERE_FILES_LIE: &[(&str, &str, &[&str])] = &[
    (
        "a.cjs",
        r#"const path = require("path"); require(path.join(path.dirname(require.resolve("b/package.json")), x));"#,
        &["b/package.json"],
    ),
    (
        "a.cjs",
        r#"const path = require("path"), other = require("module").createRequire(__dirname + "/c/d.cjs");
           require(path.join(path.dirname(require.resolve("b/package.json")), x));
           require(path.join(path.dirname(other.resolve("b/package.json")), x));"#,
        &["b/package.json", "b/package.json"],
    ),
    (
        "a.mjs",
        r#"import path from "path"; import { fileURLToPath } from "url";
           await import(path.join(path.dirname(fileURLToPath(import.meta.resolve("b/package.json"))), x));"#,
        &["b/package.json"],
    ),
    ("a.cjs", r#"require(require.resolve("b"));"#, &[]),
    ("a.cjs", r#"console.log(require.resolve("b") + x);"#, &[]),
];

#[test]
fn what_goes_on_from_answer_of_resolver_asks_where_file_lies_for_each_call() {
    for &(path, text, expected) in ASKED_WHERE_FILES_LIE {
        analyzed(path, text, |s| {
            let asked = s.analysis.asked_of_data_files.iter();
            let mut asked: Vec<(&str, &str)> = asked
                .map(|it| (s.workspace.text(it.0), s.workspace.text(it.1)))
                .collect();
            asked.sort_unstable();
            asked.dedup();
            let mark = bun_sema::import_sites::WHERE_FILE_LIES;
            let questions = asked.iter().filter(|it| it.1.as_bytes().starts_with(mark));
            let names: Vec<&str> = questions.map(|it| it.0).collect();
            assert_eq!(names, expected, "{text}");
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

#[test]
fn require_made_of_handed_url_is_site_where_it_names_json_alone() {
    let programs = [
        (
            r#"function read(url: string) { return createRequire(url)(name); } read(import.meta.url);"#,
            0,
        ),
        (
            r#"function read(url: string) { const load = createRequire(url); load(name); return load("./a.json"); } read(import.meta.url);"#,
            1,
        ),
        (
            r#"function read() { return createRequire(import.meta.url)(name); } read();"#,
            1,
        ),
        (
            r#"function read(url: string, names: string[]) { const load = createRequire(url); for (const name of names) load(name); } read(import.meta.url, ["./a.json", "../a.json"]);"#,
            1,
        ),
        (
            r#"function read(url: string, names: string[]) { const load = createRequire(url); for (const name of names) load(name); } read(import.meta.url, ["./a.json", "./a.cjs"]);"#,
            0,
        ),
        (
            r#"function read(url: string) { return createRequire(url)("./" + name + ".json"); } read(import.meta.url);"#,
            0,
        ),
        (
            r#"function read(url: string) { return createRequire(url)(flag ? "./a.json" : "./b.json"); } read(import.meta.url);"#,
            1,
        ),
        (
            r#"function read(url: string) { return createRequire(url)(flag ? "./a.json" : "./b.cjs"); } read(import.meta.url);"#,
            0,
        ),
    ];
    for (text, count) in programs {
        let text = format!(r#"import {{ createRequire }} from "node:module"; {text}"#);
        analyzed("a.mts", &text, |s| {
            let sites = s.analysis.import_sites.iter();
            let required = sites.filter(|site| matches!(site.kind, ImportSiteKind::Require(_)));
            assert_eq!(required.count(), count, "{text}");
        });
    }
}

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
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; createRequire(__dirname + "/lib/")("./a");"#,
        Some(Some("./lib/")),
    ),
    (
        "a.ts",
        r#"import { createRequire } from "node:module"; createRequire(__dirname + "/lib/")("./a");"#,
        Some(Some("./lib/")),
    ),
    (
        "a.cjs",
        r#"process.getBuiltinModule("node:module").createRequire(__dirname + "/lib/")("./a");"#,
        Some(Some("./lib/")),
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; import { join } from "node:path"; import { fileURLToPath } from "node:url"; createRequire(join(fileURLToPath(new URL(".", import.meta.url)), "lib", "index.js"))("./a");"#,
        Some(Some("./lib/index.js")),
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; import { join } from "node:path"; import { fileURLToPath } from "node:url"; createRequire(join(fileURLToPath(new URL(".", import.meta.url), other), "lib", "index.js"))("./a");"#,
        None,
    ),
    (
        "a.mjs",
        r#"import { createRequire } from "node:module"; import { join } from "node:path"; import { fileURLToPath } from "./own.mjs"; createRequire(join(fileURLToPath(new URL(".", import.meta.url)), "lib", "index.js"))("./a");"#,
        None,
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

const NAMES_THAT_ARE_ONE_OF_A_FEW: &[(&str, &[&str])] = &[
    (
        "const uses = { a: './a', quiet() {}, b: './b' }; for (const name in uses) if (typeof uses[name] === 'string') require(uses[name]);",
        &["./a", "./b"],
    ),
    (
        "let table = { a: './a' }; table ??= null; require(table.a);",
        &["./a"],
    ),
    (
        "import { fileURLToPath } from 'node:url'; await import(fileURLToPath(new URL(`./a/${x}.js`, import.meta.url)));",
        &["./a/*.js"],
    ),
    (
        "import { fileURLToPath } from 'node:url'; const folder = fileURLToPath(new URL('../a', import.meta.url)); require(require('path').join(folder, x + '.js'));",
        &["./../a/*.js"],
    ),
    (
        "import { fileURLToPath } from 'node:url'; require(require('path').join(fileURLToPath(import.meta.url), '..', 'a', x));",
        &["./a/*"],
    ),
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
        "var uses = { a(found) {}, b: found => found }; for (const name in uses) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "var uses = { a(found) {}, b: found => found }; for (const name of Object.keys(uses)) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "var uses; uses = { a(found) {}, b: found => found }; for (const name in uses) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: found => found }; for (const name of Object.getOwnPropertyNames(uses)) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: found => found }; for (const name of Reflect.ownKeys(uses)) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "var uses = { a(found) {}, b: found => found }; var names = Object.keys(uses); for (const name of names) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: found => found }; for (const [name, use] of Object.entries(uses)) use(require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: found => found }; for (const pair of Object.entries(uses)) pair[1](require(`./${pair[0]}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: found => found }; Object.entries(uses).forEach(([name, use]) => use(require(`./${name}.node`)));",
        &["./a.node", "./b.node"],
    ),
    (
        "var uses; function go() { for (const name of Object.keys(uses)) uses[name](require(`./${name}.node`)); } uses = { a(found) {} }; go(); uses = { b(found) {} }; go();",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: found => found }; for (const name in uses) if (uses.hasOwnProperty(name)) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: found => found }; for (const name of Object?.keys(uses)) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "if (x) { var uses = { a(found) {} }; } else { var uses = { b(found) {} }; } for (const name in uses) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const table = { a: 1, b: 2 }; for (const name in table) require(`./${name}.node`);",
        &["./a.node", "./b.node"],
    ),
    (
        "const table = { a: 1, b: 2 }; for (const name in table) require(name);",
        &["a", "b"],
    ),
    (
        "const uses = { a: 1 }; const names = Object.keys(uses); require(`./${names.length}.node`);",
        &["./*.node", "./a.node", "./undefined.node"],
    ),
    (
        "const table = (module.exports = { a: './a', b: './b' }); require(table[x]);",
        &["./a", "./b"],
    ),
    (
        "function load({ files }) { for (const file of files) require(file); } load({ files: ['./a', './b'] });",
        &["./a", "./b"],
    ),
    (
        "let table; x && (table = { a: './a' }); require(table.a);",
        &["./a"],
    ),
    (
        "const { plugins } = { plugins: ['./a', './b'] }; for (const plugin of plugins) require(plugin);",
        &["./a", "./b"],
    ),
    (
        "const found = [{ name: 'a', file: './a' }, { name: 'b', file: './b' }].find(it => it.name === x); require(found.file);",
        &["./a", "./b"],
    ),
    (
        "for (const it of [x ? null : { name: './a' }, { name: './b' }].filter(it => it)) require(it.name);",
        &["./a", "./b"],
    ),
    (
        "for (const it of [{ name: './a', tags: ['x'] }, { name: './b' }].filter(it => it.tags && it.tags.includes('x'))) require(it.name);",
        &["./a", "./b"],
    ),
    (
        "for (const it of [{ name: './a', isOn: () => true }, { name: './b' }].filter(it => !it.isOn || it.isOn())) require(it.name);",
        &["./a", "./b"],
    ),
    (
        "for (const it of [{ name: './a', on: 1 }, { name: './b' }].filter(it => it.hasOwnProperty('on'))) require(it.name);",
        &["./a", "./b"],
    ),
    (
        "function isFirst() { return x; } for (const it of [{ name: './a', matches: isFirst }].filter(it => it.matches())) require(it.name);",
        &["./a"],
    ),
    (
        "const isOn = it => it.on !== false; for (const it of [{ name: './a', on: x }].filter(it => isOn(it))) require(it.name);",
        &["./a"],
    ),
    (
        "const known = name => name.length > 3; for (const it of [{ name: './a' }].filter(({ name }) => known(name))) require(it.name);",
        &["./a"],
    ),
    (
        "let far; const uses = far = { a(found) {} }; for (const name in uses) uses[name](require(`./${name}.node`));",
        &["./a.node"],
    ),
    (
        "const uses = { a() { uses.b = 1; } }; for (const name in uses) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {} }; uses.b = found => found; for (const name in uses) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const found = [{ name: 'a', file: './a' }].find(it => { it.seen = true; return it.name === x; }); require(found.file);",
        &["./a"],
    ),
    (
        "var helper = (this && this.helper) || function () {}; const table = (exports.table = { a: './a' }); require(table.a);",
        &["./a"],
    ),
    (
        "const table = (exports.table = { a: './a' }); exports.load = function () { return arguments.length; }; (0, exports.load)(); require(table.a);",
        &["./a"],
    ),
    (
        "const table = (exports.table = { a: './a' }); if (!module.parent && process.argv.length > x) require(table.a);",
        &["./a"],
    ),
    (
        "const table = (module.exports = { a: './a' }); if (require.main === module) this.ran = exports.ran = true; require(table.a);",
        &["./a"],
    ),
    (
        "function load() {} class Walk {} exports.a = exports.b = void 0; exports.load = load; exports.Walk = Walk; exports.size = 1; const table = (exports.table = { a: './a' }); require(table.a);",
        &["./a"],
    ),
    (
        "const table = (exports.table = { a: './a' }); if (require.main === module) require(table.a);",
        &["./a"],
    ),
    (
        "const table = (exports.table = { a: './a' }); exports.load = () => require(table.a);",
        &["./a"],
    ),
    (
        "let table = null; table ||= { a: './a' }; require(table.a);",
        &["./a"],
    ),
    (
        "function load(files = ['./a', './b']) { for (const file of files) require(file); } load();",
        &["./a", "./b"],
    ),
    (
        "for (const [os, it] of [['one', { name: './a' }]].filter(([os]) => os !== x)) require(it.name);",
        &["./a"],
    ),
    (
        "function load({ files, log }) { for (const file of files) log(require(file)); } load({ files: ['./a'], log: x });",
        &["./a"],
    ),
    (
        "const uses = { a(found) { return found; }, b: found => found }; for (const name in uses) uses[name](require(`./${name}.node`));",
        &["./a.node", "./b.node"],
    ),
    (
        "const uses = { a(found) {}, b: function (found) {} }; for (const name of Object.keys(uses)) uses[name](require(`./${name}.node`));",
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
    (
        "let kept; const [...[first]] = (kept = [{ path: './b' }]); log(first.path); function idle() {} import(kept[0].path);",
        &["./b"],
    ),
    (
        "const kept = [{ path: './b' }]; const [...[first]] = kept; log(first.path); function idle() {} import(kept[0].path);",
        &["./b"],
    ),
    (
        "const [, ...[second]] = ['./a', './b']; require(second);",
        &["./b"],
    ),
    (
        "const [...[, second]] = ['./a', './b']; require(second);",
        &["./b"],
    ),
    ("const [[inner]] = [['./a']]; require(inner);", &["./a"]),
    (
        "const [...[...[deep]]] = ['./a']; require(deep);",
        &["./a"],
    ),
    (
        "for (const [...[name]] of [['./a'], ['./b']]) require(name);",
        &["./a", "./b"],
    ),
];

const NAMES_THAT_ARE_NOT_FOLLOWED: &[&str] = &[
    "let table = { a: './a' }; function get() { return (table ??= null); } get().a = './c'; require(table.a);",
    "let table = { x: { a: './a' } }; hand((table ||= {}).x); require(table.x.a);",
    "const uses = { quiet() {} }; for (const name in uses) require(uses[name]);",
    "const Reflect = other; const uses = { a(found) {}, b: found => found }; for (const name of Reflect.ownKeys(uses)) require(name);",
    "var uses = { a(found) {}, b: found => found }; uses = other; for (const name in uses) require(name);",
    "const uses = { a(found) {}, b: found => found }; for (const name of Object.keys?.(uses)) require(name);",
    "var names = ['a']; names = other; for (const name of names) require(name);",
    "const uses = { a: {} }; for (const [name, use] of Object.entries(uses)) require(name);",
    "const uses = { a(found) {}, b: found => found }; for (const [name = other] of Object.entries(uses)) require(name);",
    "const uses = { a(found) {}, b: found => found }; for (const [...name] of Object.entries(uses)) require(name);",
    "const uses = { a(found) {}, b: found => found }; for (const [name] of other) require(name);",
    "const uses = { a() { this[0] = other; } }; for (const pair of Object.entries(uses)) pair[1](require(pair[0]));",
    "const uses = { a(found) {} }; uses.__defineGetter__('b', () => other); for (const name in uses) uses[name](require(name));",
    "const uses = { a(found) {} }; uses.__defineSetter__('b', other); for (const name in uses) uses[name](require(name));",
    "const uses = { a(found) {} }; uses.valueOf()['b'] = other; for (const name in uses) uses[name](require(name));",
    "const uses = { a(found) {} }; uses[other](); for (const name in uses) uses[name](require(name));",
    "const uses = {}; uses.toLocaleString(); for (const name in uses) require(name);",
    "const uses = { a(found) {} }; uses.valueOf``.b = other; for (const name in uses) uses[name](require(name));",
    "const uses = { a(found) {} }; const same = uses.valueOf``; same.b = other; for (const name in uses) uses[name](require(name));",
    "var uses = { a(found) {} }; var uses = other; for (const name in uses) require(name);",
    "const Object = other; const uses = { a(found) {} }; for (const name of Object?.keys(uses)) require(name);",
    "module.exports.b = other; if (x) { var exports = { a(found) {} }; } else if (y) { var exports = { c(found) {} }; } for (const name in exports) exports[name](require(name));",
    "module.exports.b = other; if (x) { var exports = { a(found) {} }; } for (const name in exports) exports[name](require(name));",
    "function load(uses = other) { if (x) { var uses = { a(found) {} }; } for (const name in uses) uses[name](require(name)); }",
    "var uses = { a(found) {} }; { function uses() {} uses.b = other; } for (const name in uses) uses[name](require(name));",
    "function load() { if (x) { var uses = { a(found) {} }; } { function uses() {} uses.b = other; } for (const name in uses) uses[name](require(name)); }",
    "if (x) { var uses = { a(found) {} }; } for (var uses = { b(found) {} } in {}); for (const name in uses) uses[name](require(name));",
    "const laid = '__defineGetter__'; var uses; uses = { [laid](found) {} }; uses = { a(found) {} }; uses.__defineGetter__('b', () => other); for (const name of Object.keys(uses)) uses[name](require(name));",
    "var uses; uses = { __defineSetter__(found) {} }; uses = { a(found) {} }; uses.__defineSetter__('b', () => {}); for (const name of Object.keys(uses)) require(name);",
    "const uses = { a(found) {} }; Object.defineProperty(uses.valueOf``, 'b', { enumerable: true, value: other }); for (const name of Object.keys(uses)) uses[name](require(name));",
    "var uses = { a(found) {} }; switch (x) { case 1: function uses() {} uses.b = other; } for (const name in uses) uses[name](require(name));",
    "[{ a(found, code) { eval(code); } }].forEach(uses => { for (const name in uses) uses[name](require(name), x); });",
    "const uses = module.exports = { a(found) {} }; module.exports.b = other; for (const name in uses) uses[name](require(name));",
    "let far; const uses = far = { a(found) {} }; far.b = other; for (const name in uses) uses[name](require(name));",
    "let uses; const far = uses = { a(found) {} }; far.b = other; for (const name in uses) uses[name](require(name));",
    "const names = module.exports = ['a']; module.exports.push(other); for (const name of names) require(name);",
    "const uses = [{ a(found) {} }].find(table => { table.b = other; return true; }); for (const name in uses) uses[name](require(name));",
    "const { table: uses, table: far } = { table: { a(found) {} } }; far.b = other; for (const name in uses) uses[name](require(name));",
    "function load({ table: uses, table: far }) { far.b = other; for (const name in uses) uses[name](require(name)); } load({ table: { a(found) {} } });",
    "new Set([{ a(found) {} }]).forEach((uses, far) => { far.b = other; for (const name in uses) uses[name](require(name)); });",
    "[{ a(found) {} }].forEach((far, index, all) => { far.b = other; const uses = all[0]; for (const name in uses) uses[name](require(name)); });",
    "let later; const far = [{ a(found) {} }].find(uses => { later = () => { for (const name in uses) uses[name](require(name)); }; return true; }); far.b = other;",
    "let later; const far = [{ a(found) {} }].filter(uses => { later = () => { for (const name in uses) uses[name](require(name)); }; return true; }); far[0].b = other;",
    "for (const it of [{ name: 'a' }].filter(it => { it.name = other; return true; })) require(it.name);",
    "const isOn = it => { it.name = other; return true; }; for (const it of [{ name: 'a' }].filter(it => isOn(it))) require(it.name);",
    "function grow() { this.name = other; } for (const it of [{ name: 'a', grow }].filter(it => it.grow())) require(it.name);",
    "for (const it of [{ name: 'a' }].filter(it => it)) { change(it); require(it.name); }",
    "const kept = [{ name: 'a' }].filter(it => it); kept[0].name = other; for (const it of kept) require(it.name);",
    "const uses = { a(found) {} }; Object.entries(uses).filter(pair => { pair[0] = other; return true; }).forEach(([name, use]) => use(require(name)));",
    "for (const [name] of (x ? [] : Object.entries({ a: 1 })).filter(pair => { pair[0] = other; return true; })) require(name);",
    "const uses = { a: require('./change') }; for (const pair of Object.entries(uses)) { pair[1](x); require(pair[0]); }",
    "const { use } = require('./use'); for (const row of [['./a', use]]) row[1](require(row[0]));",
    "const uses = { name: 'a', self: ({}).valueOf }; const again = uses.self(); again.name = other; require(uses.name);",
    "const uses = { a(found) {} }; uses.b = other; for (const name in uses) uses[name](require(name));",
    "const uses = { a(found) {} }; uses[other] = found => found; for (const name in uses) uses[name](require(name));",
    "const uses = { a(found) {} }; x(uses.b = found => found); for (const name in uses) uses[name](require(name));",
    "const uses = { a(found) {} }; uses.b = function () { this.c = other; }; for (const name in uses) uses[name](require(name));",
    "const table = (exports.table = { a: './a' }); exports.table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); change(exports); require(table.a);",
    "const names = (exports.listed = ['a']); this.listed.push(other); for (const name of names) require(name);",
    "const names = (exports.listed = ['a']); exports.grow = function () { this.listed.push(other); }; exports.grow(); for (const name of names) require(name);",
    "const names = (exports.listed = ['a']); Object.defineProperty(exports, 'grow', { get() { return this.listed.push(other); } }); exports.grow; for (const name of names) require(name);",
    "const table = (exports.table = { a: './a' }); this.table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); change(this); require(table.a);",
    "const table = (exports.table = { a: './a' }); exports.valueOf().table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); exports.change = require('./change'); exports.change(); require(table.a);",
    "const table = (exports.table = { a: './a' }); Object.defineProperty(exports, 'change', require('./descriptor')); require(table.a);",
    "const table = (exports.table = { a: './a' }); arguments[0].table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); (() => arguments[0])().table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); require(__filename).table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); exports.change = require('./change'); exports.change``; require(table.a);",
    "const table = (exports.table = { a: './a' }); exports.__proto__ = require('./proto'); exports.other; require(table.a);",
    "const table = (exports.table = { a: './a' }); process.mainModule.exports.table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); change(process); require(table.a);",
    "const table = (exports.table = { a: './a' }); globalThis.process.mainModule.exports.table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); function change() { eval(x); } require(table.a);",
    "const table = (exports.table = { a: './a' }); module.children[0].exports.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); !change(module); require(table.a);",
    "const table = (exports.table = { a: './a' }); exports.change = require('./change'); require(table.a);",
    "const table = (exports.table = { a: './a' }); exports.change = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); Object.defineProperty(exports, 'change', { value: require('./change') }); require(table.a);",
    "const table = (exports.table = { a: './a' }); class Walk { step() { this.table.a = other; } } exports.step = Walk.prototype.step; require(table.a);",
    "const table = (exports.table = { a: './a' }); class Walk { static step() { this.table.a = other; } } exports.step = Walk.step; require(table.a);",
    "const table = (exports.table = { a: './a' }); class Walk { [(this.table.a = other, 'k')]() {} } require(table.a);",
    "let kept; const table = (exports.table = { a: './a' }); !(kept = module); kept.exports.table.a = other; require(table.a);",
    "const table = (module.exports = { a: './a' }); arguments[2].exports.a = other; require(table.a);",
    "const table = (module.exports = { a: './a' }); require(__filename).a = other; require(table.a);",
    "const table = (module.exports = { a: './a' }); require.main.exports.a = other; require(table.a);",
    "const table = (module.exports = { a: './a' }); process.mainModule.exports.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); require.main.exports.table.a = other; require(table.a);",
    "const table = (exports.table = { a: './a' }); require.cache[x].exports.table.a = other; require(table.a);",
    "const table = { entry: { path: './b' } }; export const { entry } = table; import(table.entry.path);",
    "const table = { entry: { path: './b' } }; try { throw 0; } catch (entry) { var { entry } = table; entry.path = other; } import(table.entry.path);",
    "const table = { entry: { path: './b' } }; function change({ entry }, more = 0) { var entry; entry.path = other; } change(table); import(table.entry.path);",
    "let kept; const [...[first]] = (kept = [{ path: './b' }]); first.path = other; import(kept[0].path);",
    "let kept; const [...[first]] = (kept = [{ path: './b' }]); change(first); import(kept[0].path);",
    "const kept = [{ path: './b' }]; const [...rest] = kept; change(rest); import(kept[0].path);",
    "const [...[first = other]] = ['./a']; require(first);",
    "const [...rest] = ['./a']; rest.push(other); require(rest[1]);",
    "const uses = { a() { this.b = 1; } }; for (const name in uses) uses[name](require(name));",
    "const uses = { a() { (() => this)().b = 1; } }; for (const name in uses) uses[name](require(name));",
    "const uses = { a() { super.b = 1; } }; for (const name in uses) uses[name](require(name));",
    "const uses = { a: other }; for (const name in uses) uses[name](require(name));",
    "const uses = { a() { eval(x); } }; for (const name in uses) uses[name](require(name));",
    "const table = { __proto__: more, a: 1 }; for (const name in table) require(name);",
    "const table = { a: 1, ...more }; for (const name in table) require(name);",
    "const list = ['a']; for (const name in list) require(name);",
    "const table = { a: 1 }; change(table); for (const name in table) require(name);",
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
    "let name = './a'; name += name; require(name);",
    "let name = './a'; [name] = x; require(name);",
    "const load = id => require(id); load('./a'); hand(load);",
    "function find() { return find(); } require(find());",
    "async function find() { return './a'; } require(find());",
    "export {}; const base = flag ? import.meta.url : 'file:///nowhere/'; import(new URL('./a.mjs', base).href);",
];

const NAMES_WITH_A_PART_OUT_OF_WHAT_MAY_CHANGE: &[(&str, &[&str])] = &[
    (
        "let name = './a'; while (c) name += 'b'; require(name);",
        &["./a*"],
    ),
    (
        "let name = './a'; const grow = () => { name += 'b'; }; require(name);",
        &["./a*"],
    ),
    (
        "for (let name = './a', i = 0; i < 3; i++) { name += 'b'; require(name + '.js'); }",
        &["./a*.js"],
    ),
    (
        "for (let name = './a', i = 0; i < 3; i++, name += 'b') require(name + '.js');",
        &["./a*.js"],
    ),
    (
        "for (let name of ['./a', './c']) { name += 'b'; require(name + '.js'); }",
        &["./a.js", "./ab.js", "./c.js", "./cb.js"],
    ),
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
        "export {}; await import(new URL('./a/', import.meta.url).href + x);",
        ResolvedForm::Url,
        &["./a/*"],
    ),
    (
        "export {}; await import(new URL('../a/', import.meta.url) + x);",
        ResolvedForm::Url,
        &["../a/*"],
    ),
    (
        "export {}; await import(import.meta.resolve('./a/') + x);",
        ResolvedForm::Url,
        &["./a/*"],
    ),
    (
        "export {}; await import(import.meta.resolve('../a/') + x);",
        ResolvedForm::Url,
        &["../a/*"],
    ),
    (
        "export {}; await import(import.meta.resolve('./a.js') + x);",
        ResolvedForm::Url,
        &["./a.js*"],
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
    "export {}; await import(import.meta.resolve('a') + x);",
    "export {}; class URL {} await import(new URL('./a.js', import.meta.url));",
    "export {}; function URL() {} await import(new URL('./a.js', import.meta.url));",
    "export {}; async function load(URL) { await import(new URL('./a.js', import.meta.url)); }",
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
        "class Worker extends Base {} new Worker('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "class Worker {} Worker = Other; new Worker('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "export {}; new Worker(new URL(`./a/${x}.js`, import.meta.url), { name });",
        &["./a/*.js"],
    ),
    (
        "export {}; import { Worker as Thread } from 'node:worker_threads'; new Thread('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "export {}; import * as threads from 'worker_threads'; new threads.Worker('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "const { Worker: Thread } = require('worker_threads'); new Thread('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "const threads = require('node:worker_threads'); const Thread = threads.Worker; new Thread(c ? './a.js' : './b.js');",
        &["./a.js", "./b.js"],
    ),
    (
        "const Thread = Worker; new Thread('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "const Thread = globalThis.Worker; new Thread('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "function start(Worker) { new Worker('./a/' + x + '.js'); }",
        &["./a/*.js"],
    ),
    (
        "export {}; import { Worker } from './pool.js'; new Worker('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "const Worker = pick(); new Worker('./a/' + x + '.js');",
        &["./a/*.js"],
    ),
    (
        "with (scope) { new Worker('./a/' + x + '.js'); }",
        &["./a/*.js"],
    ),
];

const NAMES_OF_WORKERS_THAT_ARE_WHOLE_OR_UNKNOWN: &[&str] = &[
    "new Worker('./a.js');",
    "new Worker(x);",
    "new Worker(x + '.js');",
    "new Worker();",
    "new Other('./a/' + x);",
    "class Worker { constructor(job) {} } new Worker('./a/' + x);",
    "function Worker(job) {} new Worker('./a/' + x);",
    "const Worker = class { constructor(job) {} }; new Worker('./a/' + x);",
    "const Worker = function (job) {}; new Worker('./a/' + x);",
    "const Worker = Other; new Worker('./a/' + x);",
    "const { MessageChannel: Worker } = require('node:worker_threads'); new Worker('./a/' + x);",
    "export {}; import { MessageChannel as Worker } from 'node:worker_threads'; new Worker('./a/' + x);",
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

const URLS_WITH_CODE_GIVEN_TO_CONSTRUCTORS: &[(&str, bool)] = &[
    ("new Worker('data:text/javascript,' + '1');", true),
    (
        "export {}; import { Worker as Thread } from 'node:worker_threads'; new Thread('data:text/javascript,' + '1');",
        true,
    ),
    (
        "const Thread = require('worker_threads').Worker; new Thread('data:text/javascript,' + '1');",
        true,
    ),
    (
        "function start(Worker) { new Worker('data:text/javascript,' + '1'); }",
        true,
    ),
    ("new threads.Worker('data:text/javascript,' + '1');", true),
    (
        "class Worker {} new Worker('data:text/javascript,' + '1');",
        false,
    ),
    (
        "function Worker() {} new Worker('data:text/javascript,' + '1');",
        false,
    ),
    ("new Other('data:text/javascript,' + '1');", false),
];

#[test]
fn url_with_code_is_kept_where_a_worker_may_start_from_it() {
    for &(text, is_kept) in URLS_WITH_CODE_GIVEN_TO_CONSTRUCTORS {
        let path = if text.starts_with("export") {
            "a.mjs"
        } else {
            "a.cjs"
        };
        with_workspace(|w| {
            let s = &w.analyze(&Source::new(path, text), &w.fold_inputs(&TARGET));
            let constructions = find_exprs(&s.hir, |kind| matches!(kind, ExprKind::New(_)));
            let kept = constructions.into_iter().any(|construction| {
                let ExprKind::New(call) = s.hir[construction].kind else {
                    return false;
                };
                let argument = s.hir.ids(s.hir[call].args).next();
                argument.is_some_and(|argument| {
                    let url = s.analysis.decisions.specifier(argument);
                    matches!(url, ImportSpecifier::Constant(_))
                })
            });
            assert_eq!(kept, is_kept, "{text}");
        });
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

const MODULE_RELATIVE_READS: &[(&str, &str, &[&str])] = &[
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync(new URL('./a.txt', import.meta.url));",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; readFileSync(fileURLToPath(new URL('../a.txt', import.meta.url)), 'utf8');",
        &["./../a.txt"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; import { join } from 'node:path'; fs.readFile(join(import.meta.dirname, 'b', 'a.txt'), done);",
        &["./b/a.txt"],
    ),
    (
        "a.mjs",
        "import { readFile } from 'node:fs/promises'; import { join } from 'node:path'; await readFile(join(import.meta.dirname, 'a.txt'));",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import * as fs from 'node:fs'; import { join } from 'node:path'; await fs.promises.readFile(join(import.meta.dirname, 'a.txt'));",
        &["./a.txt"],
    ),
    (
        "a.cjs",
        "const fs = require('fs'); const path = require('path'); fs.createReadStream(path.join(__dirname, 'a.txt'));",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { openSync } from 'node:fs'; import { join } from 'node:path'; openSync(join(import.meta.dirname, 'a.txt')); openSync(join(import.meta.dirname, 'b.txt'), 'r');",
        &["./a.txt", "./b.txt"],
    ),
    (
        "a.mjs",
        "import { join } from 'node:path'; const file = Bun.file(join(import.meta.dir, 'a.txt')); await file.text(); await Bun.file(join(import.meta.dir, 'b.json')).json();",
        &["./a.txt", "./b.json"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; function read(base) { return readFileSync(new URL('./a.txt', base)); } read(import.meta.url);",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; function read(options) { return readFileSync(new URL('./a.txt', options.url)); } read({ url: import.meta.url });",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; function read(base) { return readFileSync(new URL('./a.txt', base)); } read(import.meta.url); read(other);",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; export function read(base) { return readFileSync(new URL('./a.txt', base)); } read(import.meta.url);",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync(new URL(flag ? './a.txt' : './b.txt', import.meta.url));",
        &["./a.txt", "./b.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; const read = (base, name) => readFileSync(new URL(name, base)); read(import.meta.url, './b.txt'); read(import.meta.url, './a.txt');",
        &["./a.txt", "./b.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync(new URL(flag ? './a.txt' : name, import.meta.url));",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; export function read(options = {}) { const base = options.base ?? import.meta.url; return readFileSync(new URL('./a.txt', base)); }",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync(flag ? one : other);",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; import { join } from 'node:path'; let file; if (flag) file = other; else file = join(import.meta.dirname, 'a.txt'); readFileSync(file);",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; function read(base) { return readFileSync(new URL('./a.txt', base)); } read(import.meta.url); read(other ?? 'file:///nowhere/');",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync(new URL('./a.txt', 'file:///nowhere/'));",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync('a.txt'); readFileSync('./a.txt'); readFileSync('/p/a.txt');",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; import { join } from 'node:path'; readFileSync(join(import.meta.dirname, name));",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; import { join } from 'node:path'; readFileSync(join(process.cwd(), 'a.txt'));",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync(new URL('./a.txt', import.meta.url).href);",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; if (false) readFileSync(new URL('./a.txt', import.meta.url));",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from './mine.js'; readFileSync(new URL('./a.txt', import.meta.url));",
        &[],
    ),
    (
        "a.mjs",
        "export {}; function readFileSync() {} readFileSync(new URL('./a.txt', import.meta.url));",
        &[],
    ),
    (
        "a.mjs",
        "export {}; other.readFileSync(new URL('./a.txt', import.meta.url));",
        &[],
    ),
    (
        "a.mjs",
        "import { readFileSync } from 'node:fs'; readFileSync(...all);",
        &[],
    ),
    (
        "a.mjs",
        "import { openSync } from 'node:fs'; openSync(new URL('./a.txt', import.meta.url), 'w'); openSync(new URL('./a.txt', import.meta.url), 'r+'); openSync(new URL('./a.txt', import.meta.url), flags);",
        &[],
    ),
    (
        "a.mjs",
        "import { existsSync, statSync } from 'node:fs'; existsSync(new URL('./a.txt', import.meta.url)); statSync(new URL('./a.txt', import.meta.url));",
        &["./a.txt", "./a.txt"],
    ),
    (
        "a.mjs",
        "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('./a.txt', import.meta.url), text);",
        &[],
    ),
    (
        "a.mjs",
        "import { join } from 'node:path'; Bun.file(join(import.meta.dir, 'a.txt')); await Bun.write(Bun.file(join(import.meta.dir, 'a.txt')), text);",
        &[],
    ),
    (
        "a.mjs",
        "import { join } from 'node:path'; await other.file(join(import.meta.dir, 'a.txt')).text();",
        &[],
    ),
    (
        "a.mjs",
        "export {}; await response.json(); await response.text();",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.openSync(new URL('./a.txt', import.meta.url), fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { openSync, constants } from 'node:fs'; openSync(new URL('./a.txt', import.meta.url), constants.O_RDONLY);",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.openSync(new URL('./a.txt', import.meta.url), fs.constants.O_RDONLY | fs.constants.O_CREAT);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.openSync(new URL('./a.txt', import.meta.url), fs.constants.O_RDWR);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.openSync(new URL('./a.txt', import.meta.url), fs.constants.O_RDONLY | flags);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.openSync(new URL('./a.txt', import.meta.url), fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 1));",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; const constants = { O_RDONLY: 1 }; fs.openSync(new URL('./a.txt', import.meta.url), constants.O_RDONLY);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; import os from 'node:os'; fs.openSync(new URL('./a.txt', import.meta.url), os.constants.O_RDONLY);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.accessSync(new URL('./a.txt', import.meta.url)); fs.lstatSync(new URL('./b.txt', import.meta.url));",
        &["./a.txt", "./b.txt"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.accessSync(new URL('./a.txt', import.meta.url), fs.constants.W_OK);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.accessSync(new URL('./a.txt', import.meta.url), fs.constants.R_OK | fs.constants.W_OK);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.accessSync(new URL('./a.txt', import.meta.url), process.argv.length);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.accessSync(new URL('./a.txt', import.meta.url), 2);",
        &[],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.accessSync(new URL('./a.txt', import.meta.url), fs.constants.F_OK | fs.constants.R_OK);",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { access } from 'node:fs'; access(new URL('./a.txt', import.meta.url), () => {});",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.access(new URL('./a.txt', import.meta.url), fs.constants.R_OK, () => {});",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import { stat, access } from 'node:fs/promises'; await stat(new URL('./a.txt', import.meta.url)); await access(new URL('./b.txt', import.meta.url));",
        &["./a.txt", "./b.txt"],
    ),
    (
        "a.mjs",
        "await Bun.file(new URL('./a.txt', import.meta.url)).exists();",
        &["./a.txt"],
    ),
    (
        "a.mjs",
        "import fs from 'node:fs'; fs.readdirSync(new URL('./a', import.meta.url)); fs.mkdirSync(new URL('./b', import.meta.url));",
        &[],
    ),
];

#[test]
fn finds_module_relative_reads() {
    for &(name, text, paths) in MODULE_RELATIVE_READS {
        with_workspace(|w| {
            let s = &w.analyze(&Source::new(name, text), &w.fold_inputs(&TARGET));
            let read = s.analysis.module_relative_reads.iter();
            let described: Vec<String> = read
                .map(|&(_, path)| s.workspace.text(path).to_string())
                .collect();
            assert_eq!(described, paths, "{text}");
            let lays_nothing_else = s.analysis.names_out_of_data_files.is_empty()
                && s.analysis.asked_of_other_files.is_empty()
                && s.analysis.asked_of_data_files.is_empty()
                && s.analysis.asked_of_own_exports.is_empty();
            assert!(lays_nothing_else, "{text}");
        });
    }
}

const KNOWN_LOAD_NAMES: &[(&str, &str, &[&str])] = &[
    (
        "a.mjs",
        "import path from 'node:path'; import.meta.require(path.join(process.argv[2] ?? import.meta.dirname, 'a.json'));",
        &["./a.json"],
    ),
    (
        "a.mjs",
        "import path from 'node:path'; const load = folder => import.meta.require(path.join(folder, 'a.json')); load(process.argv[2] ?? import.meta.dirname);",
        &["./a.json"],
    ),
    (
        "a.mjs",
        "import path from 'node:path'; const load = (folder = import.meta.dirname) => import(path.join(folder, 'a.json')); load(process.argv[2]);",
        &["./a.json"],
    ),
    (
        "a.cjs",
        "const path = require('node:path'); require(path.join(process.env.FOLDER || __dirname, 'a.json'));",
        &["./a.json"],
    ),
    (
        "a.mjs",
        "const load = name => import.meta.require(name); load(process.argv[2] ?? './a.json');",
        &["./a.json"],
    ),
    (
        "a.mjs",
        "import path from 'node:path'; import.meta.require(path.join(process.argv[2], 'a.json'));",
        &[],
    ),
    (
        "a.mjs",
        "import path from 'node:path'; let folder = import.meta.dirname; folder = process.argv[2]; import.meta.require(path.join(folder, 'a.json'));",
        &[],
    ),
    (
        "a.mjs",
        "import path from 'node:path'; import.meta.require(path.join(import.meta.dirname, 'a.json'));",
        &[],
    ),
    (
        "a.mjs",
        "import path from 'node:path'; import.meta.resolve(path.join(process.argv[2] ?? import.meta.dirname, 'a.json'));",
        &[],
    ),
];

#[test]
fn finds_known_load_names() {
    for &(name, text, names) in KNOWN_LOAD_NAMES {
        with_workspace(|w| {
            let s = &w.analyze(&Source::new(name, text), &w.fold_inputs(&TARGET));
            let known = s.analysis.known_load_names.iter();
            let described: Vec<String> = known
                .map(|&(_, name)| s.workspace.text(name).to_string())
                .collect();
            assert_eq!(described, names, "{text}");
        });
    }
}

const CALLER_RELATIVE_READS: &[(&str, &[&str], &[&str])] = &[
    (
        "import { readFileSync } from 'node:fs'; export function read(base) { return readFileSync(new URL('./data.txt', base)); }",
        &["read 0 ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; export const read = (options, base) => readFileSync(fileURLToPath(new URL('../a.txt', base)));",
        &["read 1 ./../a.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; function read(base) { return readFileSync(new URL('./data.txt', base)); } export { read as t };",
        &["read 0 ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; import path from 'node:path'; const NOTES = 'notes.json'; export function read(base) { const folder = path.dirname(fileURLToPath(base)); for (const found of [path.resolve(folder, NOTES), path.resolve(folder, '..', NOTES)]) { try { return readFileSync(found); } catch {} } }",
        &["read 0 ./../notes.json", "read 0 ./notes.json"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(base) { return readFileSync(new URL('./data.txt', base)); } read(import.meta.url);",
        &["read 0 ./data.txt"],
        &["read 0"],
    ),
    (
        "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; import path from 'node:path'; export function read(base) { return readFileSync(base ? path.join(import.meta.dirname, 'a.txt') : fileURLToPath(new URL('./b.txt', base))); }",
        &["read 0 ./b.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; export function read(base) { return readFileSync(fileURLToPath(base)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; export function read(base) { return readFileSync(fileURLToPath(base).slice(0, -1) + 'data.txt'); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(base) { return readFileSync(new URL(base.slice(0, -1) + 'data.txt')); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; import { fileURLToPath } from 'node:url'; export function read(base) { return readFileSync(fileURLToPath(base).replace(/[^/]$/, '') + 'data.txt'); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(base) { base = other; return readFileSync(new URL('./data.txt', base)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(base, name) { return readFileSync(new URL(name, base)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(base) { arguments[0] = other; return readFileSync(new URL('./data.txt', base)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; function read(base) { return readFileSync(new URL('./data.txt', base)); } read(import.meta.url);",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; read(import.meta.url);",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; read(1, import.meta.url);",
        &[],
        &["read 1"],
    ),
    (
        "import { read } from './lib.mjs'; read(...list, import.meta.url);",
        &[],
        &[],
    ),
    (
        "import * as lib from './lib.mjs'; lib.read(import.meta.url);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; if (false) read(import.meta.url);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read(import.meta.dirname);",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { return readFileSync(new URL('./data.txt', options.moduleUrl)); }",
        &["read 0 moduleUrl ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options = {}) { const base = options.base ?? import.meta.url; return readFileSync(new URL('./data.txt', base)); }",
        &["read 0 base ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { return readFileSync(new URL('./data.txt', options)); }",
        &["read 0 ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { return readFileSync(new URL(options.name, options.moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { return readFileSync(flag ? new URL('./a.txt', options.moduleUrl) : new URL('./b.txt', options)); }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ moduleUrl: import.meta.url });",
        &[],
        &["read 0 moduleUrl"],
    ),
    (
        "import { read } from './lib.mjs'; read(1, { name: 'x', base: import.meta.url });",
        &[],
        &["read 1 base"],
    ),
    (
        "import { read } from './lib.mjs'; read({ [key]: import.meta.url }); read({ get base() { return import.meta.url; } }); read({ inner: { base: import.meta.url } });",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { options.url = other; return readFileSync(new URL('./data.txt', options.url)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { delete options.url; return readFileSync(new URL('./data.txt', options.url)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { Object.assign(options, { url: other }); return readFileSync(new URL('./data.txt', options.url)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; function change(o) { o.url = other; } export function read(options) { change(options); return readFileSync(new URL('./data.txt', options.url)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { options.url ??= other; return readFileSync(new URL('./data.txt', options.url)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { log(options.name); return readFileSync(new URL('./data.txt', options.url)); }",
        &["read 0 url ./data.txt"],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ url: import.meta.url, url: other });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ url: import.meta.url, ...far });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ url: import.meta.url, [key]: other });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ url: import.meta.url, get url() { return other; } });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ ...far, url: other, url: import.meta.url, name: 'x' });",
        &[],
        &["read 0 url"],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ moduleUrl }) { moduleUrl = other; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ moduleUrl }) { const set = () => { moduleUrl = other; }; set(); return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ [key]: moduleUrl }) { return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ ...rest }) { return readFileSync(new URL('./data.txt', rest.moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ moduleUrl }) { log(moduleUrl); return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &["read 0 moduleUrl ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ moduleUrl }) { return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &["read 0 moduleUrl ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(name, { moduleUrl: base }) { return readFileSync(new URL('./data.txt', base)); }",
        &["read 1 moduleUrl ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ moduleUrl = other }) { return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ inner: { moduleUrl } }) { return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read({ ...rest }) { return readFileSync(new URL('./data.txt', rest.moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read([moduleUrl]) { return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { return readFileSync(flag ? new URL('./a.txt', options.moduleUrl) : new URL('./b.txt', options.other)); }",
        &["read 0 moduleUrl ./a.txt"],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ moduleUrl: import.meta.url, get early() { return 1; } });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ get early() { return 1; }, moduleUrl: import.meta.url });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ set early(value) {}, moduleUrl: import.meta.url });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ change() {}, moduleUrl: import.meta.url });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ __proto__: far, moduleUrl: import.meta.url });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read({ change: () => 1, moduleUrl: import.meta.url });",
        &[],
        &["read 0 moduleUrl"],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { moduleUrl } = options; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &["read 0 moduleUrl ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { name, moduleUrl: base } = options; log(name); return readFileSync(new URL('./data.txt', base)); }",
        &["read 0 moduleUrl ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { log(options.name); const { moduleUrl } = options; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &["read 0 moduleUrl ./data.txt"],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { moduleUrl = other } = options; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { [key]: moduleUrl } = options; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { ...rest } = options; return readFileSync(new URL('./data.txt', rest.moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { moduleUrl, ...rest } = options; log(rest); return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { inner: { moduleUrl } } = options; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { let { moduleUrl } = options; moduleUrl = other; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { options.moduleUrl = other; const { moduleUrl } = options; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { change(options); const { moduleUrl } = options; return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &[],
        &[],
    ),
    (
        "import { readFileSync } from 'node:fs'; export function read(options) { const { other: moduleUrl } = options; log(options.moduleUrl); return readFileSync(new URL('./data.txt', moduleUrl)); }",
        &["read 0 other ./data.txt"],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const here = import.meta.url; read(here);",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; const moduleUrl = import.meta.url; read({ moduleUrl });",
        &[],
        &["read 0 moduleUrl"],
    ),
    (
        "import { read } from './lib.mjs'; const here = import.meta.url; read({ moduleUrl: here });",
        &[],
        &["read 0 moduleUrl"],
    ),
    (
        "import { read } from './lib.mjs'; const first = import.meta.url; const here = first; read(here);",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; var here = import.meta.url; read(here);",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; { const here = import.meta.url; if (here) { read(here); } }",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; function hand() { const here = import.meta.url; read(here); }",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; let here = import.meta.url; here = other; read(here);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; let moduleUrl = import.meta.url; moduleUrl = other; read({ moduleUrl });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; let here = import.meta.url; const set = () => { here = other; }; set(); read(here);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const here = other; read(here);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const { here } = { here: import.meta.url }; read(here);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; function hand(here) { read(here); } hand(import.meta.url);",
        &[],
        &["hand 0"],
    ),
    (
        "import { read } from './lib.mjs'; const moduleUrl = import.meta.url; read({ moduleUrl, moduleUrl: other });",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; read(here); var here = import.meta.url;",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; function pick(which) { switch (which) { case 0: const here = import.meta.url; case 1: return read(here); } }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; hand(); const here = import.meta.url; function hand() { read(here); }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const hand = () => read(here); hand(); const here = import.meta.url;",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; for (;;) { read(here); const here = import.meta.url; }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const here = import.meta.url; function hand() { read(here); } hand();",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const here = import.meta.url, there = read(here);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; try { other(); var here = import.meta.url; } finally { read(here); }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const here = first; read(here); var first = import.meta.url;",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; if (flag) var here = import.meta.url; else read(here);",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; function pick(which) { switch (which) { case 0: var here = import.meta.url; break; default: read(here); } }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; const here = import.meta.url; switch (which) { case 0: read(here); }",
        &[],
        &["read 0"],
    ),
    (
        "import { read } from './lib.mjs'; const moduleUrl = import.meta.url; try { log(read({ moduleUrl })); } catch {}",
        &[],
        &["read 0 moduleUrl"],
    ),
    (
        "import { read } from './lib.mjs'; read({ moduleUrl }); var moduleUrl = import.meta.url;",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; function hand() { using here = import.meta.url; read(here); }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; async function hand() { await using here = import.meta.url; read(here); }",
        &[],
        &[],
    ),
    (
        "import { read } from './lib.mjs'; function hand() { let here = import.meta.url; read(here); }",
        &[],
        &["read 0"],
    ),
];

#[test]
fn finds_caller_relative_reads() {
    for &(text, read, handed) in CALLER_RELATIVE_READS {
        with_workspace(|w| {
            let s = &w.analyze(&Source::new("a.mjs", text), &w.fold_inputs(&TARGET));
            let name = |symbol| s.workspace.text(s.bound.symbol(symbol).name);
            let mut described: Vec<String> = (s.analysis.caller_relative_reads.iter())
                .map(|it| {
                    let path = s.workspace.text(it.path);
                    let property = it.property.map(|it| format!("{} ", s.workspace.text(it)));
                    let property = property.unwrap_or_default();
                    format!("{} {} {property}{path}", name(it.function), it.place)
                })
                .collect();
            described.sort();
            assert_eq!(described, read, "{text}");
            let described: Vec<String> = (s.analysis.own_url_arguments.iter())
                .map(|it| {
                    let property = it.property.map(|it| format!(" {}", s.workspace.text(it)));
                    let property = property.unwrap_or_default();
                    format!("{} {}{property}", name(it.function), it.place)
                })
                .collect();
            assert_eq!(described, handed, "{text}");
            let lays_nothing_else = s.analysis.names_out_of_data_files.is_empty()
                && s.analysis.asked_of_other_files.is_empty()
                && s.analysis.asked_of_data_files.is_empty()
                && s.analysis.asked_of_own_exports.is_empty();
            assert!(lays_nothing_else, "{text}");
        });
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
