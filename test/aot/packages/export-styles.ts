// The ways in which packages export: a function with properties, `exports.x =`, what TypeScript, Babel and bundlers emit, UMD, re-exports of other files, getters, cycles, JSON, ES modules.
import { js, pkg, ways, type Case } from "./run-packages";

const differs =
  "A default import from a CommonJS module that assigns nothing to `exports` is a build error.";

export const cases: Case[] = [
  {
    name: "function",
    files: {
      ...pkg("s_fn", {
        "index.js": `function f(a) { return "f" + a; }
f.sub = function () { return "sub"; };
f.version = "1.0";
module.exports = f;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_fn", ["sub", "version"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_fn";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { sub } from "s_fn";
import * as self from "./function.reexported.mjs";
${js}t("reexported", () => self.sub);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "function-default",
    files: {
      ...pkg("s_fn_default", {
        "index.js": `function f(a) { return "f" + a; }
module.exports = f;
module.exports.default = f;
module.exports.extra = 7;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_fn_default", ["extra"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_fn_default";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { extra } from "s_fn_default";
import * as self from "./function-default.reexported.mjs";
${js}t("reexported", () => self.extra);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "plain",
    differs: "The bundler moves `exports.name = function () {}` to a variable `$name`, which names the function. Under --aot its name stays empty, as in `bun run`.",
    files: {
      ...pkg("s_plain", {
        "index.js": `exports.a = 1;
exports.b = function () { return "b" + exports.a; };
exports.set = function (v) { exports.a = v; };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_plain", ["a", "b", "set"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_plain";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { a } from "s_plain";
import * as self from "./plain.reexported.mjs";
${js}t("reexported", () => self.a);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "typescript",
    files: {
      ...pkg("s_ts", {
        "index.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.named = exports.K = void 0;
class K { m() { return "K.m"; } }
exports.K = K;
function named() { return "named"; }
exports.named = named;
exports.default = { tag: "the default" };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_ts", ["named", "K"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_ts";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { named } from "s_ts";
import * as self from "./typescript.reexported.mjs";
${js}t("reexported", () => self.named);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "typescript-reexport",
    files: {
      ...pkg("s_ts_reexport", {
        "index.js": `"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.one = void 0;
var one_1 = require("./one");
Object.defineProperty(exports, "one", { enumerable: true, get: function () { return one_1.one; } });
__exportStar(require("./two"), exports);
`,
        "one.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.one = void 0;
const two_1 = require("./two");
function one() { return "one+" + (0, two_1.two)(); }
exports.one = one;
`,
        "two.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.two = exports.TWO = void 0;
exports.TWO = 2;
function two() { return "two"; }
exports.two = two;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_ts_reexport", ["one", "two", "TWO"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_ts_reexport";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { one } from "s_ts_reexport";
import * as self from "./typescript-reexport.reexported.mjs";
${js}t("reexported", () => self.one);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "babel",
    files: {
      ...pkg("s_babel", {
        "index.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.default = void 0;
exports.helper = helper;
function helper() { return "helper"; }
var _default = exports.default = function main() { return "main"; };
module.exports = exports.default;
module.exports.default = exports.default;
module.exports.helper = helper;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_babel", ["helper"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_babel";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { helper } from "s_babel";
import * as self from "./babel.reexported.mjs";
${js}t("reexported", () => self.helper);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "umd",
    files: {
      ...pkg("s_umd", {
        "index.js": `(function (root, factory) {
  if (typeof define === "function" && define.amd) { define([], factory); }
  else if (typeof module === "object" && module.exports) { module.exports = factory(); }
  else { root.Umd = factory(); }
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function Umd(v) { this.v = v; }
  Umd.prototype.get = function () { return this.v; };
  Umd.create = function (v) { return new Umd(v); };
  return Umd;
}));
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_umd", ["create"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_umd";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { create } from "s_umd";
import * as self from "./umd.reexported.mjs";
${js}t("reexported", () => self.create);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "umd-exports",
    files: {
      ...pkg("s_umd_exports", {
        "index.js": `(function (global, factory) {
  typeof exports === "object" && typeof module !== "undefined" ? factory(exports) :
  typeof define === "function" && define.amd ? define(["exports"], factory) :
  (global = typeof globalThis !== "undefined" ? globalThis : global || self, factory(global.U = {}));
})(this, (function (exports) { "use strict";
  function x() { return "x"; }
  const y = 5;
  exports.x = x;
  exports.y = y;
  Object.defineProperty(exports, "__esModule", { value: true });
}));
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_umd_exports", ["x", "y"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_umd_exports";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { x } from "s_umd_exports";
import * as self from "./umd-exports.reexported.mjs";
${js}t("reexported", () => self.x);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "whole",
    differs: "The namespace lists what the bundle lists, without `default`. The bundler moves `exports.name = function () {}` to a variable `$name`, which names the function. Under --aot its name stays empty, as in `bun run`.",
    files: {
      ...pkg("s_whole", {
        "index.js": `module.exports = require("./lib/main.js");
`,
        "lib/main.js": `exports.go = function () { return "go"; };
exports.n = 3;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_whole", ["go", "n"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_whole";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { go } from "s_whole";
import * as self from "./whole.reexported.mjs";
${js}t("reexported", () => self.go);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "spread",
    files: {
      ...pkg("s_spread", {
        "index.js": `module.exports = { ...require("./a"), ...require("./b"), own: "own" };
`,
        "a.js": `module.exports = { a: () => "a" };
`,
        "b.js": `exports.b = () => "b";
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_spread", ["a", "b", "own"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_spread";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { a } from "s_spread";
import * as self from "./spread.reexported.mjs";
${js}t("reexported", () => self.a);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "by-env",
    files: {
      ...pkg("s_by_env", {
        "index.js": `"use strict";
if (process.env.NODE_ENV === "production") {
  module.exports = require("./prod.js");
} else {
  module.exports = require("./dev.js");
}
`,
        "prod.js": `exports.mode = "prod"; exports.f = function () { return "p"; };
`,
        "dev.js": `exports.mode = "dev"; exports.f = function () { return "d"; };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_by_env", ["mode", "f"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_by_env";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { mode } from "s_by_env";
import * as self from "./by-env.reexported.mjs";
${js}t("reexported", () => self.mode);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "assign",
    differs: "The bundle reads `ns.A` as undefined when `Object.assign(module.exports, { A })` adds it, and lists `late` first. --aot reads the property, as `bun run` does.",
    files: {
      ...pkg("s_assign", {
        "index.js": `class A { who() { return "A"; } }
Object.assign(module.exports, { A, make: () => new A() });
module.exports.late = "late";
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_assign", ["A", "make", "late"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_assign";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { A } from "s_assign";
import * as self from "./assign.reexported.mjs";
${js}t("reexported", () => self.A);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "class",
    files: {
      ...pkg("s_klass", {
        "index.js": `class Base { constructor(v) { this.v = v; } static of(v) { return new Base(v); } }
module.exports = Base;
module.exports.Base = Base;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_klass", ["Base", "of"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_klass";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { Base } from "s_klass";
import * as self from "./class.reexported.mjs";
${js}t("reexported", () => self.Base);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "lazy-getters",
    files: {
      ...pkg("s_lazy_getters", {
        "index.js": `const log = [];
Object.defineProperty(exports, "heavy", { enumerable: true, configurable: true, get() { log.push("heavy asked"); return require("./heavy.js"); } });
exports.log = log;
`,
        "heavy.js": `module.exports = { weight: 100 };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_lazy_getters", ["heavy", "log"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_lazy_getters";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { heavy } from "s_lazy_getters";
import * as self from "./lazy-getters.reexported.mjs";
${js}t("reexported", () => self.heavy);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "cycle",
    files: {
      ...pkg("s_cycle", {
        "index.js": `exports.early = "early";
const b = require("./b.js");
exports.fromB = b.seen;
exports.late = "late";
exports.again = () => b.look();
`,
        "b.js": `const a = require("./index.js");
exports.seen = Object.keys(a).join();
exports.look = () => Object.keys(a).join();
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_cycle", ["early", "fromB", "late", "again"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_cycle";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { early } from "s_cycle";
import * as self from "./cycle.reexported.mjs";
${js}t("reexported", () => self.early);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "both-names",
    files: {
      ...pkg("s_both_names", {
        "index.js": `exports = module.exports = function f() { return "f"; };
exports.helper = () => "helper";
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_both_names", ["helper"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_both_names";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { helper } from "s_both_names";
import * as self from "./both-names.reexported.mjs";
${js}t("reexported", () => self.helper);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "json",
    files: {
      ...pkg("s_json", {
        "index.js": `module.exports = require("./data.json");
`,
        "data.json": `{ "name": "data", "list": [1, 2], "nested": { "k": true } }
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_json", ["name", "list", "nested"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_json";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { name } from "s_json";
import * as self from "./json.reexported.mjs";
${js}t("reexported", () => self.name);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "this-exports",
    files: {
      ...pkg("s_this_exports", {
        "index.js": `this.viaThis = "this";
exports.viaExports = "exports";
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_this_exports", ["viaThis", "viaExports"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_this_exports";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { viaThis } from "s_this_exports";
import * as self from "./this-exports.reexported.mjs";
${js}t("reexported", () => self.viaThis);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "side-effect",
    files: {
      ...pkg("s_side_effect", {
        "index.js": `globalThis.__seen = (globalThis.__seen || []).concat("side_effect ran");
exports.v = 1;
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_side_effect", ["v"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_side_effect";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { v } from "s_side_effect";
import * as self from "./side-effect.reexported.mjs";
${js}t("reexported", () => self.v);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "esm",
    files: {
      ...pkg("s_esm", {
        "index.mjs": `export default function d() { return "d"; }
export const c = "c";
export let n = 0;
export function inc() { n++; return n; }
export class K { m() { return "m"; } }
export * from "./more.mjs";
export * as ns from "./more.mjs";
export { default as other, x as renamed } from "./more.mjs";
`,
        "more.mjs": `export default "more default";
export const x = "x";
export const z = "z";
`,
      }, {"main": "index.mjs", "type": "module"}),
    },
    importers: {
      ...ways("s_esm", ["c", "n", "inc", "K", "x", "z", "ns", "other", "renamed"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_esm";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { c } from "s_esm";
import * as self from "./esm.reexported.mjs";
${js}t("reexported", () => self.c);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "esm-of-cjs",
    files: {
      ...pkg("s_esm_of_cjs", {
        "index.mjs": `export { go, n } from "./lib.cjs";
export { default as lib } from "./lib.cjs";
import * as all from "./lib.cjs";
export const keys = Object.keys(all).sort().join();
`,
        "lib.cjs": `exports.go = function () { return "go"; };
exports.n = 3;
`,
      }, {"main": "index.mjs", "type": "module"}),
    },
    importers: {
      ...ways("s_esm_of_cjs", ["go", "n", "lib", "keys"], { tag: "x", hasDefault: false, typed: false }),
      "bare.mjs": `import "s_esm_of_cjs";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { go } from "s_esm_of_cjs";
import * as self from "./esm-of-cjs.reexported.mjs";
${js}t("reexported", () => self.go);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "esm-cycle",
    files: {
      ...pkg("s_esm_cycle", {
        "index.mjs": `import { b, callA } from "./b.mjs";
export function a() { return "a"; }
export const viaB = b();
export const round = callA();
`,
        "b.mjs": `import { a } from "./index.mjs";
export function b() { return "b"; }
export function callA() { return a() + "<-b"; }
`,
      }, {"main": "index.mjs", "type": "module"}),
    },
    importers: {
      ...ways("s_esm_cycle", ["a", "viaB", "round"], { tag: "x", hasDefault: false, typed: false }),
      "bare.mjs": `import "s_esm_cycle";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { a } from "s_esm_cycle";
import * as self from "./esm-cycle.reexported.mjs";
${js}t("reexported", () => self.a);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "dual",
    files: {
      ...pkg("s_dual", {
        "index.cjs": `exports.kind = "cjs"; exports.f = () => "cjs f";
`,
        "index.mjs": `export const kind = "esm"; export const f = () => "esm f";
`,
      }, {"main": "index.cjs", "exports": {".": {"import": "./index.mjs", "require": "./index.cjs"}}}),
    },
    importers: {
      ...ways("s_dual", ["kind", "f"], { tag: "x", hasDefault: false, typed: false }),
      "bare.mjs": `import "s_dual";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { kind } from "s_dual";
import * as self from "./dual.reexported.mjs";
${js}t("reexported", () => self.kind);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "esm-top-level-await",
    files: {
      ...pkg("s_esm_tla", {
        "index.mjs": `export const v = await Promise.resolve("awaited");
export default v + "!";
`,
      }, {"main": "index.mjs", "type": "module"}),
    },
    importers: {
      ...ways("s_esm_tla", ["v"], { tag: "x", typed: false, required: false }),
      "bare.mjs": `import "s_esm_tla";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { v } from "s_esm_tla";
import * as self from "./esm-top-level-await.reexported.mjs";
${js}t("reexported", () => self.v);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "babel-star",
    files: {
      ...pkg("s_babel_star", {
        "index.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  own: true,
  helper: true
};
Object.defineProperty(exports, "helper", {
  enumerable: true,
  get: function () {
    return _helper.default;
  }
});
Object.defineProperty(exports, "own", {
  enumerable: true,
  get: function () {
    return _own.own;
  }
});
var _own = require("./own.js");
var _helper = require("./helper.js");
var _a = require("./a.js");
Object.keys(_a).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _a[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _a[key];
    }
  });
});
var _b = require("./b.js");
Object.keys(_b).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _b[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _b[key];
    }
  });
});
const extra = exports.extra = { tag: "extra" };
`,
        "own.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.own = own;
function own() { return "own"; }
`,
        "helper.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = helper;
function helper() { return "helper"; }
`,
        "a.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.a1 = a1;
exports.A2 = void 0;
function a1() { return "a1"; }
const A2 = exports.A2 = ["x"];
`,
        "b.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.b1 = exports.B2 = void 0;
const b1 = exports.b1 = Symbol.for("b1").toString();
const B2 = exports.B2 = { k: 1 };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_babel_star", ["own", "helper", "a1", "A2", "b1", "B2", "extra"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_babel_star";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { own } from "s_babel_star";
import * as self from "./babel-star.reexported.mjs";
${js}t("reexported", () => self.own);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "object-in-const",
    files: {
      ...pkg("s_object_in_const", {
        "index.js": `const parse = require("./parse");
const stringify = require("./stringify");

const API = {
    parse,
    stringify,
};

module.exports = API;
`,
        "parse.js": `module.exports = function parse(t) { return "parsed " + t; };
`,
        "stringify.js": `module.exports = function stringify(v) { return "text " + v; };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_object_in_const", ["parse", "stringify"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_object_in_const";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { parse } from "s_object_in_const";
import * as self from "./object-in-const.reexported.mjs";
${js}t("reexported", () => self.parse);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "error-factory",
    files: {
      ...pkg("s_error_factory", {
        "index.mjs": `const codes = {};
function makeErrorWithCode(Base, key) {
  return class NodeError extends Base {
    constructor(...parameters) { super(parameters.join(" ")); this.code = key; }
    toString() { return this.name + " [" + key + "]: " + this.message; }
  };
}
codes.ERR_A = makeErrorWithCode(TypeError, "ERR_A");
codes.ERR_B = makeErrorWithCode(Error, "ERR_B");
export function fail(which) { try { throw new codes[which === 1 ? "ERR_A" : "ERR_B"]("bad", "thing"); } catch (e) { return String(e) + " " + (e instanceof TypeError) + " " + (e instanceof Error) + " " + e.code; } }
export const names = Object.keys(codes).join();
`,
      }, {"main": "index.mjs", "type": "module"}),
    },
    importers: {
      ...ways("s_error_factory", ["fail", "names"], { tag: "x", hasDefault: false, typed: false }),
      "bare.mjs": `import "s_error_factory";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { fail } from "s_error_factory";
import * as self from "./error-factory.reexported.mjs";
${js}t("reexported", () => self.fail);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "effects-only",
    differs,
    files: {
      ...pkg("s_effects_only", {
        "index.js": `var Reflect2;
(function (Reflect2) { (function (factory) { var root = typeof globalThis === "object" ? globalThis : Function("return this;")(); factory(function (k, v) { root[k] = v; }); })(function (exporter) { exporter("__installed", "yes"); }); })(Reflect2 || (Reflect2 = {}));
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_effects_only", [], { tag: "x", typed: false }),
      "bare.mjs": `import "s_effects_only";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "alias-chain",
    files: {
      ...pkg("s_alias_chain", {
        "index.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  react: true
};
exports.react = void 0;
var _lowercase = require("./lowercase.js");
Object.keys(_lowercase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _lowercase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _lowercase[key];
    }
  });
});
var _uppercase = require("./uppercase.js");
Object.keys(_uppercase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _uppercase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _uppercase[key];
    }
  });
});
var _constants = require("./constants.js");
Object.keys(_constants).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _constants[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _constants[key];
    }
  });
});
const react = exports.react = {
  tag: "react"
};
`,
        "lowercase.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alpha = alpha;
exports.beta = beta;
function alpha() { return "alpha"; }
function beta() { return "beta"; }
`,
        "uppercase.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Beta = exports.Alpha = void 0;
var b = require("./lowercase.js");
function alias(lowercase) {
  {
    return b[lowercase];
  }
}
const Alpha = exports.Alpha = alias("alpha"),
  Beta = exports.Beta = alias("beta");
`,
        "constants.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEYS = exports.FLAGS = void 0;
const KEYS = exports.KEYS = ["k"];
const FLAGS = exports.FLAGS = { f: true };
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_alias_chain", ["alpha", "beta", "Alpha", "Beta", "KEYS", "FLAGS", "react"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_alias_chain";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { alpha } from "s_alias_chain";
import * as self from "./alias-chain.reexported.mjs";
${js}t("reexported", () => self.alpha);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "renamed-getters",
    files: {
      ...pkg("s_renamed_getters", {
        "index.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _lowercase = require("./lowercase.js");
Object.keys(_lowercase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _lowercase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _lowercase[key];
    }
  });
});
var _uppercase = require("./uppercase.js");
Object.keys(_uppercase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _uppercase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _uppercase[key];
    }
  });
});
`,
        "lowercase.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alpha = alpha;
exports.beta = beta;
function alpha() { return "alpha"; }
function beta() { return "beta"; }
`,
        "uppercase.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "Alpha", {
  enumerable: true,
  get: function () {
    return _lowercase.alpha;
  }
});
Object.defineProperty(exports, "Beta", {
  enumerable: true,
  get: function () {
    return _lowercase.beta;
  }
});
var _lowercase = require("./lowercase.js");
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_renamed_getters", ["alpha", "beta", "Alpha", "Beta"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_renamed_getters";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { alpha } from "s_renamed_getters";
import * as self from "./renamed-getters.reexported.mjs";
${js}t("reexported", () => self.alpha);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "renamed-direct",
    files: {
      ...pkg("s_renamed_direct", {
        "index.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
Object.defineProperty(exports, "Alpha", {
  enumerable: true,
  get: function () {
    return _lowercase.alpha;
  }
});
Object.defineProperty(exports, "same", {
  enumerable: true,
  get: function () {
    return _lowercase.same;
  }
});
var _lowercase = require("./lowercase.js");
`,
        "lowercase.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alpha = alpha;
exports.same = same;
function alpha() { return "alpha"; }
function same() { return "same"; }
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_renamed_direct", ["Alpha", "same"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_renamed_direct";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { Alpha } from "s_renamed_direct";
import * as self from "./renamed-direct.reexported.mjs";
${js}t("reexported", () => self.Alpha);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
  {
    name: "star-twice",
    files: {
      ...pkg("s_star_twice", {
        "index.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _exportNames = {
  react: true
};
exports.react = void 0;
var _generated = require("./generated.js");
Object.keys(_generated).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _generated[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _generated[key];
    }
  });
});
var _uppercase = require("./uppercase.js");
Object.keys(_uppercase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (Object.prototype.hasOwnProperty.call(_exportNames, key)) return;
  if (key in exports && exports[key] === _uppercase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _uppercase[key];
    }
  });
});
const react = exports.react = {
  tag: "react"
};
`,
        "generated.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
var _lowercase = require("./lowercase.js");
Object.keys(_lowercase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _lowercase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _lowercase[key];
    }
  });
});
var _uppercase = require("./uppercase.js");
Object.keys(_uppercase).forEach(function (key) {
  if (key === "default" || key === "__esModule") return;
  if (key in exports && exports[key] === _uppercase[key]) return;
  Object.defineProperty(exports, key, {
    enumerable: true,
    get: function () {
      return _uppercase[key];
    }
  });
});
`,
        "lowercase.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.alpha = alpha;
exports.beta = beta;
function alpha() { return "alpha"; }
function beta() { return "beta"; }
`,
        "uppercase.js": `"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.Beta = exports.Alpha = void 0;
var b = require("./lowercase.js");
function alias(lowercase) {
  {
    return b[lowercase];
  }
}
const Alpha = exports.Alpha = alias("alpha"),
  Beta = exports.Beta = alias("beta");
`,
      }, {"main": "index.js"}),
    },
    importers: {
      ...ways("s_star_twice", ["alpha", "beta", "Alpha", "Beta", "react"], { tag: "x", typed: false }),
      "bare.mjs": `import "s_star_twice";
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
      "reexported.mjs": `export { alpha } from "s_star_twice";
import * as self from "./star-twice.reexported.mjs";
${js}t("reexported", () => self.alpha);
console.log("seen", JSON.stringify(globalThis.__seen ?? null), JSON.stringify(globalThis.__installed ?? null));
`,
    },
  },
];
