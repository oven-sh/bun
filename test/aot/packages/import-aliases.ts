// `import a = b.c` (a TypeScript import alias) where `b` comes from a package. It compiles to `const a = b.c`: read once, at the statement.
import { pkg, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "commonjs-emitted-by-typescript",
    differs: "TypeScript leaves out an `import name = a.b` that nothing uses, and so does --aot: the getter is not read. Plain Bun reads it.",
    files: {
      ...pkg("kit", {
        "index.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.version = exports.tools = void 0;
const tools = require("./tools");
exports.tools = tools;
exports.version = "1.0.0";
`,
        "index.d.ts": `import * as tools from "./tools";
export { tools };
export declare const version: string;
`,
        "tools.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.point = exports.inner = exports.Color = exports.level = exports.limit = exports.Counter = exports.twice = exports.add = void 0;
var sums_1 = require("./sums");
Object.defineProperty(exports, "add", { enumerable: true, get: function () { return sums_1.add; } });
function twice(n) { return n * 2; }
exports.twice = twice;
class Counter { constructor() { this.n = 0; Counter.made++; } next() { return ++this.n; } }
Counter.made = 0;
exports.Counter = Counter;
exports.limit = 7;
exports.level = 1;
exports.raise = function raise() { exports.level++; };
let reads = 0;
exports.reads = function () { return reads; };
Object.defineProperty(exports, "counted", { enumerable: true, get: function () { return ++reads; } });
exports.self = function self() { return this === undefined ? "undefined" : this === exports ? "the module" : typeof this; };
var Color;
(function (Color) { Color[Color["Red"] = 0] = "Red"; Color[Color["Green"] = 1] = "Green"; })(Color || (exports.Color = Color = {}));
exports.inner = { deep: function (s) { return "<" + s + ">"; }, depth: 2, most: { bottom: "bottom" } };
exports.point = { x: 1, y: 2 };
`,
        "tools.d.ts": `export { add } from "./sums";
export declare function twice(n: number): number;
export declare class Counter { n: number; next(): number; static made: number }
export declare const limit: number;
export declare let level: number;
export declare function raise(): void;
export declare function reads(): number;
export declare const counted: number;
export declare function self(this: unknown): unknown;
export declare const missing: number | undefined;
export interface Shape { side: number }
export type Name = string;
export declare enum Color { Red = 0, Green = 1 }
export declare namespace inner { function deep(s: string): string; const depth: number; namespace most { const bottom: string } }
export declare const point: { x: number; y: number };
`,
        "sums.js": `"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.add = add;
function add(n) { return n + 1; }
`,
        "sums.d.ts": `export declare function add(n: number): number;
`,
      }, {"main": "index.js", "types": "index.d.ts"}),
    },
    importers: {
      "function.ts": `import { tools } from "kit";
import add = tools.add;
import twice = tools.twice;
console.log(add(1), twice(2), typeof add, add === tools.add, [1, 2].map(twice).join());
function later() { return add(10) + twice(10); }
console.log(later());
`,
      "class.ts": `import { tools } from "kit";
import Counter = tools.Counter;
const c: Counter = new Counter();
class Mine extends Counter { twice() { return this.next() + this.next(); } }
console.log(c.next(), c.next(), c instanceof Counter, c instanceof tools.Counter, Counter.made, new Mine().twice(), Counter.name);
`,
      "const_and_nested.ts": `import { tools } from "kit";
import limit = tools.limit;
import deep = tools.inner.deep;
import inner = tools.inner;
import depth = inner.depth;
import bottom = tools.inner.most.bottom;
import point = tools.point;
console.log(limit, deep("d"), inner.depth, depth, bottom, point.x + point.y, inner === tools.inner);
`,
      "mutable_member.ts": `import { tools } from "kit";
import level = tools.level;
tools.raise();
console.log(level, tools.level);
`,
      "read_once.ts": `import { tools } from "kit";
console.log(tools.reads());
import counted = tools.counted;
console.log(tools.reads(), counted, counted, counted, tools.reads());
`,
      "never_used.ts": `import { tools } from "kit";
import counted = tools.counted;
console.log(tools.reads());
`,
      "this.ts": `import { tools } from "kit";
import self = tools.self;
console.log(self(), tools.self(), self.call(1));
`,
      "missing_at_run_time.ts": `import { tools } from "kit";
import missing = tools.missing;
console.log(missing, typeof missing, missing === undefined, missing ?? "none");
`,
      "enum.ts": `import { tools } from "kit";
import Color = tools.Color;
import Green = tools.Color.Green;
const c: Color = Color.Red;
console.log(c, Color.Green, Color[1], Green, typeof Color);
`,
      "used_before_declaration.ts": `import { tools } from "kit";
function early() { return add(1); }
try { console.log(early()); } catch (e) { console.log((e as Error).name); }
import add = tools.add;
console.log(early());
`,
      "star_import.ts": `import * as kit from "kit";
import add = kit.tools.add;
import tools = kit.tools;
import limit = tools.limit;
import version = kit.version;
console.log(add(1), tools.twice(2), limit, version);
`,
      "import_equals_require.ts": `import kit = require("kit");
import add = kit.tools.add;
import tools = kit.tools;
import deep = tools.inner.deep;
console.log(add(1), tools.twice(2), deep("x"));
`,
      "whole_alias.ts": `import { tools } from "kit";
import t = tools;
import add = t.add;
console.log(t === tools, t.limit, add(2));
`,
      "in_a_namespace.ts": `import { tools } from "kit";
namespace mine { import add = tools.add; export import twice = tools.twice; export import level = tools.level; export function both(n: number) { return add(n) + twice(n); } }
tools.raise();
console.log(mine.both(1), mine.twice(3), mine.level, Object.keys(mine).join());
`,
      "captured.ts": `import { tools } from "kit";
import level = tools.level;
import add = tools.add;
const later = () => add(level);
async function soon() { await null; return add(level); }
class Uses { v = level; get() { return add(level); } static s = add(level); }
function* gen() { yield add(level); }
tools.raise();
console.log(later(), new Uses().v, new Uses().get(), Uses.s, [...gen()].join());
soon().then(console.log);
`,
      "typeof_and_operators.ts": `import { tools } from "kit";
import limit = tools.limit;
import point = tools.point;
import add = tools.add;
console.log(typeof limit, limit + 1, -limit, \`\${limit}\`, limit > 3 ? "big" : "small", "x" in point, { limit }.limit, [limit, ...[limit]].length, add?.(1), point?.x, void limit);
`,
      "default_import.ts": `import kit from "kit";
import add = kit.tools.add;
console.log(add(1));
`,
      "types_only.ts": `import { tools } from "kit";
import Shape = tools.Shape;
import Name = tools.Name;
const s: Shape = { side: 2 }; const name: Name = "n";
console.log(s.side, name);
`,
      "record_from_a_package.ts": `import { tools } from "kit";
import point = tools.point;
type Point = { x: number; y: number };
function sum(p: Point) { return p.x + p.y; }
const kept: Point = point;
console.log(sum(point), sum(kept), JSON.stringify(point), kept === tools.point);
`,
      "in_a_loop.ts": `import { tools } from "kit";
import add = tools.add;
import limit = tools.limit;
let total = 0;
for (let i = 0; i < 100000; i++) total = add(total) % (limit * 1000);
console.log(total);
`,
    },
  },
  {
    name: "re-exported",
    files: {
      "re-exported-lib.ts": `import { tools } from "kit";
export import add = tools.add;
export import level = tools.level;
export import Counter = tools.Counter;
export import tools2 = tools;
export function raised() { tools.raise(); return tools.level + ":" + level; }
`,
    },
    importers: {
      "named.ts": `import { add, level, Counter, tools2, raised } from "./re-exported-lib";
import * as all from "./re-exported-lib";
console.log(add(1), level, new Counter().next(), tools2.limit, raised(), level, all.level, Object.keys(all).sort().join());
`,
      "dynamic.ts": `const lib = await import("./re-exported-lib");
console.log(lib.add(1), lib.level, typeof lib.Counter, Object.keys(lib).sort().join());
`,
    },
  },
  {
    name: "export-equals",
    files: {
      ...pkg("whole", {
        "index.js": `"use strict";
function whole(n) { return n; }
whole.half = function half(n) { return n / 2; };
whole.unit = 1;
whole.Box = class Box { constructor(v) { this.v = v; } };
whole.sub = { name: function () { return "sub"; } };
module.exports = whole;
`,
        "index.d.ts": `declare function whole(n: number): number;
declare namespace whole {
  function half(n: number): number;
  const unit: number;
  class Box { v: number; constructor(v: number) }
  interface Options { deep: boolean }
  namespace sub { function name(): string }
}
export = whole;
`,
      }, {"main": "index.js", "types": "index.d.ts"}),
    },
    importers: {
      "import_equals_require.ts": `import whole = require("whole");
import half = whole.half;
import unit = whole.unit;
import Box = whole.Box;
import name = whole.sub.name;
import sub = whole.sub;
const b: Box = new Box(3);
console.log(whole(1), half(4), unit, b.v, name(), sub.name(), half === whole.half);
`,
      "default_import.ts": `import whole from "whole";
import half = whole.half;
import Box = whole.Box;
import name = whole.sub.name;
console.log(whole(1), half(4), new Box(3).v, name());
`,
      "star_import.ts": `import * as whole from "whole";
import half = whole.half;
import name = whole.sub.name;
console.log(half(4), name());
`,
    },
  },
  {
    name: "es-module-in-javascript",
    files: {
      ...pkg("esmkit", {
        "index.js": `export * as parts from "./parts.js";
`,
        "index.d.ts": `export * as parts from "./parts.js";
`,
        "parts.js": `export function triple(n) { return n * 3; }
export let turn = 1;
export function next() { turn++; }
`,
        "parts.d.ts": `export declare function triple(n: number): number;
export declare let turn: number;
export declare function next(): void;
`,
      }, {"type": "module", "main": "index.js", "types": "index.d.ts"}),
    },
    importers: {
      "named.ts": `import { parts } from "esmkit";
import triple = parts.triple;
import turn = parts.turn;
parts.next();
console.log(triple(2), turn, parts.turn);
`,
    },
  },
  {
    name: "commonjs-file",
    differs: "A type error stops the build: TS7016, the .cjs file has no declarations.",
    files: {
      "plain.cjs": `exports.tools = { add(n) { return n + 1; }, limit: 3 };
exports.name = "plain";
`,
    },
    importers: {
      "star_import.ts": `import * as plain from "./plain.cjs";
import tools = plain.tools;
console.log(tools.add(1), tools.limit);
`,
    },
  },
];
