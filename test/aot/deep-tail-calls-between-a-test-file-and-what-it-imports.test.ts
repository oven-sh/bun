import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Where a run is built as several programs, `return f(..)` into another program is still a tail call: the stack does not grow, and
// when the last callee returns or throws, the program that made the first call runs again.
test("300,000 tail calls that alternate between a test file, a file of the project and a package", async () => {
  using dir = tempDir("aot-deep-tail-calls-between-programs", {
    "tsconfig.json": "{}",
    "node_modules/bounces/package.json": JSON.stringify({
      name: "bounces",
      version: "1.0.0",
      type: "module",
      main: "index.js",
    }),
    "node_modules/bounces/index.js": `
export function bounce(f, n, sum) { return f(n - 1, sum + 1); }
export function bounceByCall(f, n, sum) { return f.call(undefined, n - 1, sum + 1); }
export function bounceByApply(f, n, sum) { return f.apply(undefined, [n - 1, sum + 1]); }
export function bounceByReflect(f, n, sum) { return Reflect.apply(f, undefined, [n - 1, sum + 1]); }
export function bounceBySpread(f, n, ...rest) { return f(n - 1, ...rest); }
// As many arguments as n says, so that each frame has another size than the one it replaces.
export function bounceWithMany(f, n, sum) { return f(n - 1, sum + 1, ...list.slice(0, n % 23)); }
const list = Array.from({ length: 23 }, (_, i) => i);
export function bounceThrough(g, f, n, sum) { return g(f, n, sum); }
export function guarded(f, n) {
  try { return f(n, 0); } catch (error) { return "the package caught " + error.message + " " + /(\\d+) deep/.exec(error.message)?.[1] + " " + tag(); }
}
// Native code calls these two, and they call what the test file gave them: their frames stay.
let given;
export function give(f) { given = f; }
export function replacer(match) { return given(match); }
export function reviver(key, value) { return given(key, value); }
export function addsOne(f, n) { return 1 + f(n - 1); }
export const handsOut = { get next() { return given; } };
export function bounceByGetter(n, sum) { return handsOut.next(n - 1, sum + 1); }
export class Base { static make(f, n, sum) { return f(n - 1, sum + 1); } step(f, n, sum) { return f.call(this, n - 1, sum + 1); } }
class Tagged { #tag = "package"; read() { return this.#tag; } }
export function tag() { return new Tagged().read() + /p(a)ck/.exec("package")[1]; }
`,
    "lib.ts": `
import { bounce } from "bounces";
type Step = (n: number, sum: number) => number;
export function bounceHere(f: Step, n: number, sum: number): number { return f(n - 1, sum + 1); }
export function throughBoth(f: Step, n: number, sum: number): number { return bounce(f, n, sum); }
export function tagHere(): string { return /l(i)b/.exec("lib")![1] + JSON.stringify({ lib: 1 }); }
`,
    "tails.test.ts": `
import { test } from "bun:test";
import * as there from "bounces";
import * as lib from "./lib";
const N = 300000;
class Local { #secret = 7; constructor(readonly tag: string) {} read() { return this.tag + this.#secret; } }
// What goes by the tables of the program that runs.
function stillHere(label: string) {
  const o = { a: 1, b: "two", c: [3] }, text = label + o.a + o.b + o.c[0];
  const named = (new Error("e").stack ?? "").split("\\n")[1]?.includes("stillHere");
  return [/(\\d+)two/.exec(text)?.[1], new Local("x").read(), JSON.stringify({ ...o, d: label.length }), named, there.tag(), lib.tagHere()].join(" ");
}
function tried(label: string, f: () => unknown) {
  let said;
  try { said = String(f()); } catch (error) { said = "throws " + (error as Error).name + ": " + (error as Error).message; }
  console.log("|", label, said, stillHere(label));
}
function a(n: number, sum: number): number { if (n <= 0) return sum; return there.bounce(a, n, sum); }
function b(n: number, sum: number): number { if (n <= 0) return sum; return lib.bounceHere(b, n, sum); }
function c(n: number, sum: number): number { if (n <= 0) return sum; return lib.throughBoth(c, n, sum); }
function d(n: number, sum: number): number { if (n <= 0) return sum; return there.bounceByCall(d, n, sum); }
function e(n: number, sum: number): number { if (n <= 0) return sum; return there.bounceByApply(e, n, sum); }
function f(n: number, sum: number): number { if (n <= 0) return sum; return there.bounceByReflect(f, n, sum); }
function g(n: number, sum: number): number { if (n <= 0) return sum; return there.bounceBySpread(g, n, sum + 1); }
function h(n: number, sum: number, ...rest: number[]): number { if (n <= 0) return sum + rest.length; return there.bounceWithMany(h, n, sum + rest.length); }
function i(n: number, sum: number): number { if (n <= 0) return sum; return there.bounceThrough(lib.bounceHere, i, n, sum); }
function j(n: number, sum: number): number { if (n <= 0) throw new Error(sum + " deep"); return there.bounce(j, n, sum); }
function k(n: number, sum: number): number { if (n <= 0) return sum; return n % 2 ? there.bounce(k, n, sum) : lib.bounceHere(k, n, sum); }
// Code that is made at run time stands in no program of the run.
const made = new Function("f", "n", "sum", "'use strict'; return f(n - 1, sum + 1);") as (f: unknown, n: number, sum: number) => number;
function l(n: number, sum: number): number { if (n <= 0) return sum; return there.bounceThrough(made, l, n, sum); }
function m(n: number, sum: number): number { if (n <= 0) return sum; return made(m, n, sum); }
// Another file of the run replaces these built-ins, so they are looked up here, and what is found may stand in another program.
function o(n: number, sum: number): number { if (n <= 0) return sum; return o.call(undefined, n - 1, sum + 1); }
function p(n: number, sum: number): number { if (n <= 0) return sum; return p.apply(undefined, [n - 1, sum + 1]); }
function q(n: number, sum: number): number { if (n <= 0) return sum; return Reflect.apply(q, undefined, [n - 1, sum + 1]); }
function r(n: number, ...rest: number[]): number { if (n <= 0) return rest[0]; return table.r(n - 1, ...rest); }
const table = { r };
function s(n: number): number { if (n <= 0) return 0; return there.addsOne(s, n); }
function t(n: number, sum: number): number { if (n <= 0) return sum; return there.bounceByGetter(n, sum); }
function u(n: number, sum: number): number { if (n <= 0) return sum; return there.Base.make(u, n, sum); }
const base = new there.Base();
function v(this: unknown, n: number, sum: number): number { if (n <= 0) return sum + Number(this === base); return base.step(v, n, sum); }
test("tails", () => {
  tried("a package", () => a(N, 0));
  tried("a file of the project", () => b(N, 0));
  tried("a file of the project and then a package", () => c(N, 0));
  tried("a package by call", () => d(N, 0));
  tried("a package by apply", () => e(N, 0));
  tried("a package by Reflect.apply", () => f(N, 0));
  tried("a package by a spread", () => g(N, 0));
  tried("frames of many sizes", () => h(N, 0));
  tried("a package and then a file of the project", () => i(N, 0));
  tried("a throw at the bottom", () => j(N, 0));
  tried("a throw at the bottom that the package catches", () => there.guarded(j, N));
  tried("now one, now the other", () => k(N, 0));
  tried("a package and then code made at run time", () => l(N, 0));
  tried("code made at run time", () => m(N, 0));
  tried("from a callback of a built-in", () => [1, 2].map(x => a(N + x, 0)).join());
  tried("itself by call", () => o(N, 0));
  tried("itself by apply", () => p(N, 0));
  tried("itself by Reflect.apply", () => q(N, 0));
  tried("itself by a spread", () => r(N, 5));
  there.give((match: string) => match + a(N, 0));
  tried("below a package that replace() calls", () => "xyx".replace(/x/g, there.replacer));
  there.give((key: string, value: unknown) => (typeof value === "number" ? a(N, value) : value));
  tried("below a package that JSON.parse() calls", () => JSON.stringify(JSON.parse("[1,2]", there.reviver)));
  tried("calls that are no tail calls", () => s(10_000_000));
  tried("behind a stack overflow", () => a(N, 0));
  tried("calls that are no tail calls, again", () => s(10_000_000));
  tried("behind a second stack overflow", () => c(N, 0));
  there.give(t);
  tried("a getter hands out the callee", () => t(N, 0));
  tried("a static method", () => u(N, 0));
  tried("a method that passes this on", () => v.call(base, N, 0));
});
`,
    "replaces.test.ts": `
import { test } from "bun:test";
import { bounceHere } from "./lib";
test("replaces", () => {
  const { call, apply } = Function.prototype, reflectApply = Reflect.apply;
  let calls = 0;
  Function.prototype.call = function (this: Function, self: unknown, ...rest: unknown[]) { calls++; return reflectApply(this, self, rest); };
  Function.prototype.apply = function (this: Function, self: unknown, rest: unknown[]) { calls++; return reflectApply(this, self, rest); };
  Reflect.apply = (f, self, rest) => { calls++; return reflectApply(f, self, rest); };
  function add(a: number, b: number) { return a + b; }
  console.log("|", "replaced", add.call(null, 1, 2), add.apply(null, [3, 4]), Reflect.apply(add, null, [5, 6]), calls, bounceHere(add, 1, 1));
  Function.prototype.call = call; Function.prototype.apply = apply; Reflect.apply = reflectApply;
});
`,
  });
  async function report(words: string, ...flags: string[]) {
    const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
    // With the address sanitizer and assertions the calls take 4 s under plain Bun and 13 s over layers.
    const { stdout, stderr, exitCode } = await run(
      [bunExe(), "test", "--isolate", "--parallel=2", "--timeout=60000", ...flags],
      String(dir),
      env,
    );
    const lines = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| "));
    return { lines: lines.sort(), ran: stderr.match(/^Ran \d+ tests? across \d+ files?/m)?.[0], exitCode };
  }
  const plain = await report("");
  expect(plain.ran).toBe("Ran 2 tests across 2 files");
  expect(plain.lines.length).toBe(29);
  expect(plain.lines.filter(line => line.includes("RangeError")).length).toBe(2);
  expect(plain.exitCode).toBe(0);
  expect(await report("TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await report("TestRunLayers:1,TestRunPartFiles:1", "--aot")).toEqual(plain);
  expect(await report("TestRunLayers:2,TestRunPartFiles:1", "--aot")).toEqual(plain);
});
