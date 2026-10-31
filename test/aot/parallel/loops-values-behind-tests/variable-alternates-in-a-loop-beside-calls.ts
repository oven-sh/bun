// A variable takes one of two values in turn in a loop that also calls small functions: each turn must see the value of the turn before.
// generator-or-boolean function-closure function function-or-boolean function function generator
declare function structuredClone<T>(value: T): T;
function show(x: unknown): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "string") return "'" + x + "'";
  if (typeof x === "bigint") return x + "n";
  if (x === undefined) return "u";
  if (Array.isArray(x)) {
    let all = "[";
    for (let i = 0; i < x.length && i < 12; i++) all += (i ? "," : "") + (i in x ? show(x[i]) : "hole");
    return all + "]" + x.length;
  }
  return String(x);
}
function num(x: number): string {
  return Object.is(x, -0) ? "-0" : String(x);
}
function twice(x: number): number {
  return x * 2;
}
function half(x: number): number {
  return x / 2;
}
function same<T>(x: T): T {
  return x;
}
function sum(...all: number[]): number {
  let s = 0;
  for (const e of all) s += e;
  return s;
}
function orSeven(x?: number): number {
  return x === undefined ? 7 : x;
}
function elementOf(l: number[], i: number): number | undefined {
  return l[i];
}
function deep(x: number, depth: number): number {
  return depth === 0 ? x : deep(x, depth - 1);
}
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}
class Cell {
  #v = 0;
  static last = 0;
  get value(): number {
    return this.#v;
  }
  set value(v: number) {
    this.#v = v;
  }
}
let shared: number = 0;
const zero: number = 0;
const three: number = 3;
const nine: number = 9;
const names = new Map<number, string>([[0, "zero"], [3, "three"], [9, "nine"], [4.5, "half"], [-1, "minus"], [2147483647, "most"], [4294967295, "word"], [NaN, "none"]]);
const known = new Set<number>([0, 3, 9, 4.5, -1, 2147483648, NaN]);
const words: Record<number, string> = { 0: "zero", 3: "three", 9: "nine", 64: "more" };
const given: number[] = JSON.parse("[3, 9, 0.5, 60, 0, -1, 4.5, 2147483647]");
function* run7(p: number, q: number): Generator<number, string, unknown> {
  let out = "";
  let turns = 0;
  const text: string = "abcdefghij";
  let a: number = orSeven();
  for (let x = 0; x < 3 && turns++ < 6; x++) {
  a = a === 9 ? 3 : 9;
  out += num((a + a) >>> 0) + " ";
  }
  return out + show(a);
}
{
  const steps = run7(0, 0.5);
  let result = steps.next();
  for (let i = 0; i < 60 && !result.done; i++) result = steps.next(result.value);
  console.log("7: " + result.value);
}
export {};
