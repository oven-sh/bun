// Code made at run time meets compiled code
import vm from "node:vm";
import { addUntyped, callsFromUntyped, makePlainBox, makeUntypedClosure, PlainCounter } from "./plain.js";

interface Box {
  w: number;
  h: number;
}
class Counter {
  n: number = 0;
  bump(by: number): number {
    this.n += by;
    return this.n;
  }
}
function add(a: number, b: number): number {
  return a + b;
}
function width(box: Box): number {
  return box.w;
}
function makeClosure(k: number): (x: number) => number {
  return x => x + k;
}
function makeBox(w: number, h: number): Box {
  return { w, h };
}
function withExtra(box: Box): Box {
  (box as unknown as Record<string, number>).extra = 7;
  return box;
}
function makeList(): number[] {
  return [1, 2, 3, 4, 5, 6, 7, 8];
}
function makeMap(): Map<string, number> {
  return new Map([
    ["a", 1],
    ["b", 2],
  ]);
}
function callsFromTyped(made: (x: number) => number, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += made(i);
  return s;
}

const loop = (step: string) => `let s = 0; for (let i = 0; i < n; i++) { ${step} } return s;`;
const byFunction = (step: string): Function => new Function("f", "n", loop(step));
const byEval = (step: string): Function => (0, eval)(`(function (f, n) { ${loop(step)} })`);
const byVm = (step: string): Function => vm.runInThisContext(`(function (f, n) { ${loop(step)} })`);
const madeAdd = new Function("a", "b", "return a + b;");
const madeNext = new Function("x", "return x + 1;") as (x: number) => number;

const cases: Record<string, (n: number) => unknown> = {
  "0 the loop alone": n => byFunction("s += i;")(null, n),
  "0 calls a function made of text": n => byFunction("s += f(i, 1);")(madeAdd, n),
  "1 calls a typed function (numbers)": n => byFunction("s += f(i, 1);")(add, n),
  "1 the same, made by eval": n => byEval("s += f(i, 1);")(add, n),
  "1 the same, made by node:vm": n => byVm("s += f(i, 1);")(add, n),
  "1 calls a typed function (a typed object in)": n =>
    new Function("f", "n", "box", loop("s += f(box);"))(width, n, makeBox(3, 4)),
  "1 calls a typed function (a plain object in)": n =>
    new Function("f", "n", "box", loop("s += f(box);"))(width, n, makePlainBox(3, 4)),
  "2 calls an untyped function": n => byFunction("s += f(i, 1);")(addUntyped, n),
  "3 calls a typed closure": n => byFunction("s += f(i);")(makeClosure(5), n),
  "3 calls an untyped closure": n => byFunction("s += f(i);")(makeUntypedClosure(5), n),
  "4 calls a method of a typed class": n => byFunction("s += f.bump(1);")(new Counter(), n),
  "4 calls a method of an untyped class": n => byFunction("s += f.bump(1);")(new PlainCounter(), n),
  "5 reads a declared field of a typed object": n => byFunction("s += f.w;")(makeBox(3, 4), n),
  "5 writes a declared field of a typed object": n => byFunction("f.w = i; s += 1;")(makeBox(3, 4), n),
  "5 reads an undeclared property of a typed object": n =>
    byFunction("s += f.extra === undefined ? 1 : 0;")(makeBox(3, 4), n),
  "5 writes an undeclared property of a typed object": n => byFunction("f.extra = i; s += 1;")(makeBox(3, 4), n),
  "5 reads an undeclared property that is there": n => byFunction("s += f.extra;")(withExtra(makeBox(3, 4)), n),
  "5 reads a field of a typed class's instance": n => byFunction("s += f.n;")(new Counter(), n),
  "5 reads a property of an untyped object": n => byFunction("s += f.w;")(makePlainBox(3, 4), n),
  "5 writes a property of an untyped object": n => byFunction("f.w = i; s += 1;")(makePlainBox(3, 4), n),
  "6 reads an element of a number[] of typed code": n => byFunction("s += f[i & 7];")(makeList(), n),
  "6 reads an element of a Float64Array": n => byFunction("s += f[i & 7];")(new Float64Array(8), n),
  "7 is called by typed code": n => callsFromTyped(madeNext, n),
  "7 is called by untyped code": n => callsFromUntyped(madeNext, n),
  "8 Array.prototype.push": n => byFunction("f.push(i); if ((i & 63) === 63) f.length = 0; s += 1;")(makeList(), n),
  "8 JSON.stringify of a typed object": n => byFunction("s += JSON.stringify(f).length;")(makeBox(3, 4), n),
  "8 JSON.stringify of an untyped object": n => byFunction("s += JSON.stringify(f).length;")(makePlainBox(3, 4), n),
  "8 Map.prototype.get": n => byFunction("s += f.get('b');")(makeMap(), n),
};
const name = process.argv[2];
if (name === "names") console.log(Object.keys(cases).join("\n"));
else {
  let last: unknown;
  for (const turns of process.argv.slice(3)) {
    last = cases[name](Number(turns));
    process.kill(process.pid, 0);
  }
  console.log(last);
}
