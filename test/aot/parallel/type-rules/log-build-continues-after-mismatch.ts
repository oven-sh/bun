// A log build goes on after a value fails its type, and the code after the check works on the value as it is: it prints what plain Bun prints.
// Flags: --aot-log-type-mismatches
// Env: BUN_AOT_TYPE_MISMATCH_LOG=off
import type { int32 } from "bun";

const raw: any = JSON.parse('{"text":"3","number":4,"fraction":1.5,"list":["a",2,null],"point":{"y":1,"x":"left"},"flag":"yes"}');

function double(n: number): number {
  return n * 2;
}
console.log(double(raw.text), double(raw.number));
console.log((raw.text as number) + 1, (raw.number as number) + 1);

interface Point {
  x: number;
  y: number;
}
function sum(point: Point): number {
  return point.x + point.y;
}
console.log(sum(raw.point), sum({ x: 1, y: 2 }), sum(raw.text));

class Counter {
  count: number = 0;
  label: string = "counter";
  add(step: number): number {
    this.count += step;
    return this.count;
  }
}
const counter = new Counter();
console.log(counter.add(1), counter.add(raw.text), counter.add(1));
console.log(typeof counter.count, counter.count);
counter.label = raw.number;
console.log(typeof counter.label, counter.label + 1);
const detached: any = counter.add;
console.log(detached.call({ count: 5 }, 2), detached.call(raw.point, 2));

const literal: Point = { x: raw.text, y: 2 };
console.log(literal.x + literal.y, Object.keys(literal).join());

const numbers: number[] = raw.list;
let total: number = 0;
for (const value of numbers) total += value;
console.log(total);
const own: number[] = [1, 2];
own.push(raw.text);
console.log(own[2] * 2, own.map(value => value + 1).join());

type Flag = "on" | "off";
function describe(flag: Flag): string {
  switch (flag) {
    case "on":
      return "is on";
    case "off":
      return "is off";
    default: {
      const impossible: never = flag;
      return "neither: " + impossible;
    }
  }
}
console.log(describe("on"), describe(raw.flag));

function untyped(): any {
  return raw.text;
}
function result(): number {
  return untyped();
}
console.log(result() + 1);

function pick(condition: boolean, a: string, b: string): string {
  return condition ? a : b;
}
console.log(pick(raw.text, "truthy", "falsy"), pick(raw.missing, "truthy", "falsy"), pick(true, raw.number, "b"));

let shared: number = 1;
const bump = () => {
  shared = shared + 1;
  return shared;
};
shared = raw.text;
console.log(bump(), bump());

function half(whole: int32): number {
  return whole / 2;
}
// An `any` that is passed for an `int32` stops the build, so these two calls go a way that the build does not follow.
const halfOfAnything: (whole: any) => number = half;
console.log(half(8), halfOfAnything(raw.fraction), halfOfAnything(raw.text));

function rest(...values: number[]): number {
  let joined: number = 0;
  for (const value of values) joined += value;
  return joined;
}
console.log(rest(1, 2), rest(1, raw.text, 2));

async function later(value: number): Promise<number> {
  return value;
}
console.log((await later(raw.text)) + 1);
