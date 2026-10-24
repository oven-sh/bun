// Modules that import each other and read a half-initialized module, and the order in which modules run.
import { js, pkg, type Case } from "./run-packages";

const differs =
  "An ES module and a CommonJS module that need each other: where the CommonJS file requires its importer, the importer runs there and then, as under `bun run`, and sees what the file has exported so far. `bun run` then throws, the bundler hoists.";

export const cases: Case[] = [
  {
    name: "cycles",
    differs,
    fails: true,
    files: {
      ...pkg("cyc", {
        "a.js": `exports.early = "a early";
const b = require("./b.js");
exports.sawInB = b.sawA;
exports.late = "a late";
exports.look = () => b.look();
`,
        "b.js": `const a = require("./a.js");
exports.sawA = Object.keys(a).join() + "|" + a.late;
exports.look = () => Object.keys(a).join() + "|" + a.late;
const { late, early } = a;
exports.taken = () => [late, early];
`,
        "ra.js": `const b = require("./rb.js");
module.exports = function A() { return "A sees " + typeof b.useA; };
module.exports.b = b;
`,
        "rb.js": `const A = require("./ra.js");
exports.atLoad = typeof A + ":" + Object.keys(A).length;
exports.useA = () => typeof A + ":" + typeof require("./ra.js");
`,
        "ka.js": `class Base { who() { return "Base"; } }
module.exports = Base;
const Derived = require("./kb.js");
Base.make = () => new Derived();
`,
        "kb.js": `const Base = require("./ka.js");
class Derived extends Base { who() { return "Derived<" + super.who(); } }
module.exports = Derived;
`,
        "kc.js": `const Derived = require("./kd.js");
class Base { who() { return "Base"; } }
module.exports = Base;
Base.D = Derived;
`,
        "kd.js": `const Base = require("./kc.js");
let D; try { D = class Derived extends Base {}; } catch (e) { D = e.name; }
module.exports = D;
`,
        "ea.mjs": `import { b, useA, readLet, readConst, readClass } from "./eb.mjs";
export function a() { return "a()"; }
export let aLet = "aLet";
export const aConst = "aConst";
export class AClass {}
export var aVar = "aVar";
export const out = [b, useA(), readLet(), readConst(), readClass()];
`,
        "eb.mjs": `import { a, aLet, aConst, AClass, aVar } from "./ea.mjs";
const at = (f) => { try { return String(f()); } catch (e) { return e.name; } };
export const b = ["load:", at(() => a()), at(() => aLet), at(() => aConst), at(() => typeof AClass), at(() => aVar)].join(" ");
export const useA = () => a();
export const readLet = () => aLet;
export const readConst = () => aConst;
export const readClass = () => typeof AClass;
`,
        "sa.mjs": `import * as self from "./sa.mjs";
const at = (f) => { try { return String(f()); } catch (e) { return e.name; } };
export const first = at(() => Object.keys(self).join()) + "|" + at(() => self.second) + "|" + at(() => self.fn());
export const second = 2;
export function fn() { return "fn"; }
export const after = at(() => self.second);
`,
        "ma.mjs": `import x from "./mb.cjs";
export const fromCjs = x.saw;
export const own = "ma own";
export const look = () => x.look();
`,
        "mb.cjs": `let m; try { m = require("./ma.mjs"); } catch (e) { m = { error: e.name }; }
const at = (f) => { try { return String(f()); } catch (e) { return e.name; } };
exports.saw = at(() => Object.keys(m).join()) + "|" + at(() => m.own);
exports.look = () => at(() => m.own);
`,
      }),
    },
    importers: {
      "half.cjs": `${js}const a = require("cyc/a.js");
t("a", () => [a.sawInB, a.look(), require("cyc/b.js").taken()]);
`,
      "half_b_first.cjs": `${js}const b = require("cyc/b.js");
const a = require("cyc/a.js");
t("b", () => [b.sawA, b.look(), b.taken(), a.sawInB]);
`,
      "half.mjs": `import a from "cyc/a.js";
import { taken } from "cyc/b.js";
${js}t("a", () => [a.sawInB, a.look(), taken()]);
`,
      "half_names.mjs": `import { sawInB, look, early, late } from "cyc/a.js";
${js}t("a", () => [sawInB, look(), early, late]);
`,
      "reassigned.cjs": `${js}const A = require("cyc/ra.js");
t("A", () => [A(), A.b.atLoad, A.b.useA()]);
`,
      "reassigned.mjs": `import A from "cyc/ra.js";
${js}t("A", () => [A(), A.b.atLoad, A.b.useA()]);
`,
      "classes.cjs": `${js}const Base = require("cyc/ka.js");
t("k", () => [Base.make().who(), Base.make() instanceof Base]);
`,
      "classes.mjs": `import Base from "cyc/ka.js";
${js}t("k", () => [Base.make().who(), Base.make() instanceof Base]);
`,
      "classes_derived_first.cjs": `${js}const D = require("cyc/kb.js");
t("k", () => [new D().who()]);
`,
      "classes_too_early.cjs": `${js}const Base = require("cyc/kc.js");
t("k", () => [typeof Base, show(Base.D)]);
`,
      "esm.mjs": `import { out } from "cyc/ea.mjs";
${js}t("out", () => out);
`,
      "esm_b_first.mjs": `import { b, useA, readLet } from "cyc/eb.mjs";
${js}t("b", () => [b, useA(), readLet()]);
`,
      "esm_dyn.mjs": `${js}await ta("out", () => import("cyc/ea.mjs").then((m) => m.out));
`,
      "self.mjs": `import { first, after } from "cyc/sa.mjs";
${js}t("self", () => [first, after]);
`,
      "mixed.mjs": `import { fromCjs, look } from "cyc/ma.mjs";
${js}t("mixed", () => [fromCjs, look()]);
`,
      "mixed.cjs": `${js}t("mixed", () => { const b = require("cyc/mb.cjs"); return [b.saw, b.look()]; });
`,
    },
  },
  {
    name: "order",
    differs:
      "A CommonJS module that throws while it loads, required again: `bun run` runs it again, the bundler answers the exports it had made so far. Under --aot a module of the executable runs at most once, and what it threw is thrown again.",
    fails: true,
    files: {
      ...pkg("order", {
        "log.js": `globalThis.__log = globalThis.__log || [];
module.exports = (s) => { globalThis.__log.push(s); };
`,
        "a.mjs": `import log from "./log.js";
log("a");
export const a = 1;
`,
        "b.mjs": `import log from "./log.js";
import "./c.mjs";
log("b");
export const b = 1;
`,
        "c.mjs": `import log from "./log.js";
log("c");
export const c = 1;
`,
        "d.cjs": `require("./log.js")("d");
exports.d = 1;
`,
        "e.cjs": `require("./log.js")("e start");
require("./d.cjs");
require("./log.js")("e end");
exports.e = 1;
`,
        "thrower.mjs": `import log from "./log.js";
log("thrower");
throw new RangeError("at load");
`,
        "thrower.cjs": `require("./log.js")("thrower.cjs");
exports.before = 1;
throw new RangeError("at load");
`,
        "unused.mjs": `import log from "./log.js";
log("unused ran");
export const u = 1;
`,
        "reexp.mjs": `export { a } from "./a.mjs";
export { u } from "./unused.mjs";
export * from "./c.mjs";
`,
      }),
    },
    importers: {
      "esm.mjs": `import { b } from "order/b.mjs";
import { a } from "order/a.mjs";
import "order/c.mjs";
${js}t("log", () => globalThis.__log);
`,
      "hoisted.mjs": `${js}globalThis.__log = ["entry first?"];
t("log", () => globalThis.__log);
import "order/a.mjs";
`,
      "mixed.mjs": `import "order/a.mjs";
import "order/e.cjs";
import "order/b.mjs";
${js}t("log", () => globalThis.__log);
`,
      "require.cjs": `${js}require("order/log.js")("entry");
require("order/e.cjs");
if (globalThis.__never) require("order/d.cjs");
require("order/a.mjs");
t("log", () => globalThis.__log);
`,
      "req_in_function.cjs": `${js}const log = require("order/log.js");
function lazy() { return require("order/d.cjs"); }
log("before");
lazy(); lazy();
log("after");
t("log", () => globalThis.__log);
`,
      "req_in_esm_function.mjs": `import log from "order/log.js";
${js}function lazy() { return require("order/d.cjs"); }
log("before");
lazy(); lazy();
log("after");
t("log", () => globalThis.__log);
`,
      "reexport_unused.mjs": `import { a } from "order/reexp.mjs";
${js}t("log", () => [a, globalThis.__log]);
`,
      "throws_dyn.mjs": `${js}await ta("1", () => import("order/thrower.mjs"));
await ta("2", () => import("order/thrower.mjs"));
t("log", () => globalThis.__log);
`,
      "throws_req.cjs": `${js}t("1", () => require("order/thrower.cjs"));
t("2", () => require("order/thrower.cjs"));
t("log", () => globalThis.__log);
`,
      "throws_req_esm.cjs": `${js}t("1", () => require("order/thrower.mjs"));
t("2", () => require("order/thrower.mjs"));
t("log", () => globalThis.__log);
`,
      "throws_static.mjs": `import "order/a.mjs";
import "order/thrower.mjs";
import "order/b.mjs";
console.log("never");
`,
      "throws_static_cjs.mjs": `import "order/a.mjs";
import "order/thrower.cjs";
import "order/b.mjs";
console.log("never");
`,
    },
  },
];
