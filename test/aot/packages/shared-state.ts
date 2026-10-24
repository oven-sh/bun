// One state seen through `import` and through `require`: a package with an ES wrapper around CommonJS, a package with two copies of its code, live bindings.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "wrapper",
    files: {
      ...pkg("dual_wrapper", {
        "index.cjs": `const state = { count: 0 };
exports.state = state;
exports.inc = function inc() { return ++state.count; };
exports.n = 0;
exports.bump = function bump() { return ++exports.n; };
`,
        "wrapper.mjs": `import cjs from "./index.cjs";
export const state = cjs.state;
export const inc = cjs.inc;
export const bump = cjs.bump;
export const read = () => cjs.n;
export default cjs;
`,
        "index.d.ts": `export declare const state: { count: number };
export declare function inc(): number;
export declare function bump(): number;
export declare function read(): number;
`,
      }, {"main": "./index.cjs", "exports": {".": {"types": "./index.d.ts", "import": "./wrapper.mjs", "require": "./index.cjs"}}}),
    },
    importers: {
      "both.mjs": `import { state, inc, bump, read } from "dual_wrapper";
import { createRequire } from "node:module";
${js}const require2 = createRequire(import.meta.url);
t("inc", () => inc());
t("required", () => { const r = require2("dual_wrapper"); return [r.state === state, r.inc(), state.count, r.bump(), read(), r.n]; });
`,
      "both_require.mjs": `import { state, inc, bump, read } from "dual_wrapper";
${js}t("inc", () => inc());
t("required", () => { const r = require("dual_wrapper"); return [r.state === state, r.inc(), state.count, r.bump(), read(), r.n]; });
`,
      "both.cjs": `${js}const r = require("dual_wrapper");
t("inc", () => r.inc());
import("dual_wrapper").then((m) => { t("imported", () => [m.state === r.state, m.inc(), r.state.count, m.bump(), r.n, m.read(), m.default === r]); });
`,
      "both.ts": `import { state, inc, bump, read } from "dual_wrapper";
${ts}t("inc", () => inc() + 1);
t("required", () => { const r = require("dual_wrapper"); return [r.state === state, r.inc(), state.count + 1, r.bump(), read(), r.n]; });
`,
    },
  },
  {
    name: "two-copies",
    files: {
      ...pkg("dual_true", {
        "i.cjs": `exports.state = { count: 0, kind: "cjs" };
exports.inc = () => ++exports.state.count;
exports.K = class K {};
`,
        "i.mjs": `export const state = { count: 0, kind: "esm" };
export const inc = () => ++state.count;
export class K {}
`,
      }, {"main": "./i.cjs", "exports": {".": {"import": "./i.mjs", "require": "./i.cjs"}}}),
    },
    importers: {
      "both.mjs": `import { state, inc, K } from "dual_true";
${js}const r = require("dual_true");
t("x", () => [inc(), inc(), r.inc(), state, r.state, r.state === state, new r.K() instanceof K]);
`,
      "both.cjs": `${js}const r = require("dual_true");
import("dual_true").then((m) => t("x", () => [m.inc(), m.inc(), r.inc(), m.state, r.state, new r.K() instanceof m.K]));
`,
    },
  },
  {
    name: "live",
    files: {
      ...pkg("live", {
        "index.mjs": `export let n = 0;
export function inc() { n++; return n; }
export let later;
export function set(v) { later = v; }
export { n as alias };
export default n;
export let fn = function first() { return "first"; };
export function swap() { fn = function second() { return "second"; }; }
export class K { static s = 1; }
export var hoisted = "v";
`,
        "re.mjs": `export * from "./index.mjs";
export { n as renamed, default as d } from "./index.mjs";
`,
        "index.d.ts": `export declare let n: number;
export declare function inc(): number;
export declare let later: string | undefined;
export declare function set(v: string): void;
export { n as alias };
declare const d: number;
export default d;
export declare let fn: () => string;
export declare function swap(): void;
`,
        "cjs.js": `exports.n = 0;
exports.inc = function () { exports.n++; return exports.n; };
let hidden = 0;
Object.defineProperty(exports, "g", { enumerable: true, get() { return ++hidden; } });
exports.replace = function () { module.exports = { n: "replaced" }; };
exports.add = function () { exports.added = "added"; };
`,
      }, {"exports": {".": {"types": "./index.d.ts", "default": "./index.mjs"}, "./re": "./re.mjs", "./cjs": "./cjs.js"}}),
    },
    importers: {
      "names.mjs": `import d, { n, inc, later, set, alias, fn, swap } from "live";
${js}t("0", () => [n, alias, d, later, fn()]);
inc(); inc(); set("set"); swap();
t("1", () => [n, alias, d, later, fn()]);
function inner() { return [n, alias, later, fn()]; }
inc();
t("2", inner);
t("assign", () => { n = 5; });
`,
      "namespace.mjs": `import * as ns from "live";
${js}t("0", () => [ns.n, ns.alias, ns.default, ns.later, ns.fn()]);
ns.inc(); ns.set("set"); ns.swap();
t("1", () => [ns.n, ns.alias, ns.default, ns.later, ns.fn()]);
t("assign", () => { ns.n = 5; });
t("define", () => Object.defineProperty(ns, "n", { value: 9 }));
t("delete", () => delete ns.n);
t("desc", () => Object.getOwnPropertyDescriptor(ns, "n"));
t("tag", () => [ns[Symbol.toStringTag], Object.isFrozen(ns), Object.isSealed(ns), Object.isExtensible(ns), Object.getPrototypeOf(ns)]);
t("in", () => ["n" in ns, "zz" in ns, Reflect.has(ns, "default"), Reflect.ownKeys(ns).map(String).join()]);
const k = ["n"][0];
t("computed", () => ns[k]);
t("spread", () => keys({ ...ns }));
`,
      "re.mjs": `import { n, renamed, d, inc, alias } from "live/re";
import * as ns from "live/re";
${js}t("0", () => [n, renamed, d, alias, keys(ns)]);
inc();
t("1", () => [n, renamed, d, alias, ns.n, ns.renamed]);
`,
      "names.ts": `import d, { n, inc, later, set, alias, fn, swap } from "live";
${ts}t("0", () => [n + 1, alias, d, later, fn()]);
inc(); inc(); set("set"); swap();
t("1", () => [n + 1, alias, d, later, later?.length, fn()]);
function inner(): unknown { return [n * 2, alias, later, fn()]; }
inc();
t("2", inner);
let sum = 0; for (let i = 0; i < 3; i++) { inc(); sum += n; }
t("loop", () => sum);
`,
      "cjs_names.mjs": `import { n, inc, g, replace, add } from "live/cjs";
import * as ns from "live/cjs";
import whole from "live/cjs";
${js}t("0", () => [n, g, g, ns.n, ns.g, whole.n]);
inc();
t("1", () => [n, ns.n, whole.n]);
add();
t("added", () => [ns.added, whole.added, keys(ns)]);
replace();
t("replaced", () => [n, ns.n, whole.n]);
`,
      "cjs_one.mjs": `import { n, inc } from "live/cjs";
${js}t("0", () => n);
inc();
t("1", () => n);
`,
      "cjs_getter.mjs": `import { g } from "live/cjs";
${js}t("g", () => [g, g, g]);
`,
      "cjs_req.cjs": `${js}const m = require("live/cjs");
const { n, inc } = m;
t("0", () => [n, m.n, m.g, m.g]);
inc();
t("1", () => [n, m.n]);
m.replace();
t("2", () => [m.n, require("live/cjs").n, require("live/cjs") === m]);
`,
    },
  },
];
