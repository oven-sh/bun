// A JavaScript file of 4 MB or more is lowered in parts, on as many threads as the build has. `--aot-testing=LowersInParts` does the same with a
// small one. The program does what it does under `bun run`, and the executable is the same on one thread and on all of them.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";

const env = { ...bunEnv, NO_COLOR: "1" };

const wrapped = `var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var require_shapes = __commonJS({
  "shapes.js"(exports, module) {
    class Shape {
      #id; static made = 0; name = "shape";
      constructor(id) { this.#id = id; Shape.made++; }
      static is(value) { return #id in value; }
      get id() { return this.#id; }
      describe() { return this.name + " " + this.#id + " of " + this.area(); }
      area() { return 0; }
    }
    exports.Shape = Shape;
  }
});
var require_square = __commonJS({
  "square.js"(exports, module) {
    var { Shape } = require_shapes();
    exports.Square = class extends Shape {
      name = "square";
      constructor(id, side) { super(id); this.side = side; }
      area() { return this.side ** 2; }
    };
    module.exports.unit = () => new exports.Square("unit", 1);
  }
});
var require_numbers = __commonJS({
  "numbers.js"(exports, module) {
    var counter = 0;
    function next(step = 1) { return counter += step; }
    function* upTo(end) { for (let i = 0; i < end; i++) yield next(i); }
    module.exports = { next, upTo, get counter() { return counter; } };
  }
});
var { Shape } = require_shapes(), { Square, unit } = require_square(), numbers = require_numbers();
console.log(unit().describe(), new Square("big", 12).describe(), Shape.made, Shape.is(unit()), Shape.is({}));
console.log([...numbers.upTo(6)], numbers.next(), numbers.counter);
`;

const flat = `let shared = [], total = 0;
const limits = { low: 2, high: 9 };
function isEven(n) { return n === 0 ? true : isOdd(n - 1); }
function isOdd(n) { return n === 0 ? false : isEven(n - 1); }
function note(text) { shared.push(text); total += text.length; return shared.length; }
function Point(x, y) { this.x = x; this.y = y; }
Point.prototype.plus = function (other) { return new Point(this.x + other.x, this.y + other.y); };
Point.prototype.toString = function () { return "(" + this.x + ", " + this.y + ")"; };
class Base {
  static registry = new Map();
  static { Base.registry.set("base", this); }
  kind = "base"; list = [];
  constructor(...values) { for (const value of values) this.add(value); }
  add(value) { this.list.push(value); note(this.kind); return this; }
  get size() { return this.list.length; }
  set only(value) { this.list = [value]; }
  ["com" + "puted"]() { return this.size * limits.low; }
  async later(fail) { if (fail) throw new RangeError(this.kind); return this.list; }
}
class Derived extends Base {
  #secret = 41;
  kind = "derived"; handler = () => this.#secret + this.size;
  static create(...values) { return new this(...values); }
  add(value) { return super.add(value * 2); }
  reveal() { return this.handler() + (#secret in this ? 1 : 0); }
}
var Color = (Color => { Color[Color["Red"] = 0] = "Red"; Color[Color["Green"] = 5] = "Green"; return Color; })(Color || {});
const within = value => value >= limits.low && value <= limits.high;
const pick = ({ a, b: [c, ...rest] = [7] }, fallback = () => c) => [a, c, rest.length, fallback()];
function count(list, test) { let found = 0; for (const item of list) if (test(item)) found++; return found; }
function fails(nothing) { return nothing.property.deeper; }
async function main() {
  console.log(isEven(10), isOdd(7), isEven(3), count([1, 2, 3, 9, 10], within));
  console.log(String(new Point(1, 2).plus(new Point(3, 4))), Color.Green, Color[0]);
  const derived = Derived.create(1, 2, 3); derived.only = 8;
  console.log(derived.size, derived.computed(), derived.reveal(), derived.kind, Base.registry.size, Derived.name, derived.add.name);
  console.log(await derived.later(false), await derived.later(true).catch(error => error.name + ": " + error.message));
  console.log(pick({ a: 1, b: [2, 3, 4] }), pick({ a: 0 }), shared, total);
  try { fails(shared.missing); } catch (error) { console.log(error instanceof TypeError, error.message); }
  console.log(main.length, count.length, Base.prototype.add.length, note.name);
}
main();
`;

const hoisted = `var __esm = (fn, res) => function __init() { return fn && (res = fn(fn = 0)), res; };
function parse(text) { return text.split(separator).map(Number); }
var separator, defaults;
var init_options = __esm(() => { separator = ","; defaults = Object.freeze({ digits: 2, parse }); });
function format(value, { digits } = defaults) { return value.toFixed(digits) + unit; }
var unit, Formatter;
var init_format = __esm(() => {
  init_options();
  unit = " m";
  Formatter = class Formatter { constructor(digits) { this.digits = digits; } format(value) { return format(value, this); } };
});
init_format();
console.log(parse("1,2,3").map(value => format(value)), new Formatter(1).format(4.25), defaults.parse === parse);
`;

const named = `const arrow = () => 1;
var fn = function () { return 2; };
let cls = class { m() {} };
const obj = { a: () => 3, b: function () {}, "c d": () => 4, ["k" + 2]: () => 5, get g() { return 6; }, meth() { return 7; } };
const { d = () => 8 } = {}; let e; e = function () {}; e ||= () => 9; let h; h ??= () => 10;
class K {
  static s = () => 12; f = () => 13; static #p = function () {}; static q() { return K.#p.name; } [Symbol.iterator]() {}
  static { K.late = () => 14; }
}
function outer(x = () => 15) { return x.name; }
function traced() {
  const inner = () => { throw new Error("x"); };
  try { inner(); } catch (error) { return [/inner/.test(error.stack), /traced/.test(error.stack)]; }
}
const getter = Object.getOwnPropertyDescriptor(obj, "g").get;
console.log(arrow.name, fn.name, cls.name, new cls().m.name, obj.a.name, obj.b.name, obj["c d"].name, obj.k2.name, getter.name, obj.meth.name);
console.log(d.name, e.name, h.name, K.s.name, new K().f.name, K.q(), K.prototype[Symbol.iterator].name, K.late.name === "", outer(), traced());
console.log([1].map(function own() { return own.name; })[0], (function () {}).name === "", (class {}).name === "", (() => {}).name === "");
`;

describe.concurrent.skipIf(!!unsupported)("--aot-testing=LowersInParts", () => {
  test.each([
    ["modules in wrappers", wrapped],
    ["functions and classes of one scope", flat],
    ["hoisted functions beside initializers", hoisted],
    ["names that the code around a function gives it", named],
    ["modules in wrappers, all in one function", `\n(function () {${wrapped}}).call(this);\n`],
    ["functions and classes of one function", `;(() => {${flat}})();\n`],
    ["names given inside one function", `;(() => {${flat}${named}})();\n`],
    [
      "functions that wrappers around wrappers hold",
      `;(() => { var outer = 1; (  function inner() {${hoisted}} )(); })();\n`,
    ],
  ])("%s", (_, text) =>
    slot(async () => {
      using dir = tempDir("aot-in-parts", { "bundle.js": text });
      const folder = String(dir);
      const build = (outfile: string, ...words: string[]) =>
        spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            "--aot-testing=LowersInParts",
            ...words,
            "--outfile",
            outfile,
            "bundle.js",
          ],
          folder,
          { ...env, BUN_JSC_logAOTPhaseTimes: "1" },
        );
      const [plain, first, second] = await Promise.all([
        spawned([bunExe(), "bundle.js"], folder, env),
        build("one/program", "--aot-threads=1"),
        build("all/program"),
      ]);
      expect({ first: first.exitCode, second: second.exitCode, text: first.stderr }).toMatchObject({
        first: 0,
        second: 0,
      });
      expect(first.stderr).toContain("AOT file in parts: Lower |");
      const ran = await spawned([join(folder, "one/program")], folder, env);
      expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
      expect(readFileSync(join(folder, "one/program")).equals(readFileSync(join(folder, "all/program")))).toBe(true);
    }),
  );
});
