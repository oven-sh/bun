// Functions with a declared result type that return values of their own on some paths and end in a tail call of a function value on
// others. Typed code calls them directly, other code calls them as values, and chains of such tail calls of any length run in constant space.
// A result of another kind than the declared one throws a TypeError, whatever the caller does with it.
const lines: string[] = [];
function say(...parts: unknown[]) {
  lines.push(parts.map(part => (typeof part === "object" && part !== null ? JSON.stringify(part) : String(part))).join(" "));
}
const deep = 400000;
let sink: unknown;

interface Item {
  id: number;
  name: string;
}
type Next<T> = (n: number, acc: T, next: any) => T;

function sumDown(n: number, acc: number, next: Next<number>): number {
  if (n === 0) return acc + 0.5;
  return next(n - 1, acc + n, next);
}
function countDown(n: number, acc: number, next: Next<number>): number {
  if (n === 0) return acc | 0;
  return next(n - 1, acc + 1, next);
}
function isEven(n: number, acc: boolean, next: Next<boolean>): boolean {
  if (n === 0) return acc;
  return next(n - 1, !acc, next);
}
function spell(n: number, acc: string, next: Next<string>): string {
  if (n === 0) return acc + "!";
  return next(n - 1, n % 100000 === 0 ? acc + "x" : acc, next);
}
function build(n: number, acc: Item, next: Next<Item>): Item {
  if (n === 0) return { id: acc.id, name: acc.name + "." };
  return next(n - 1, n % 100000 === 0 ? { id: acc.id + 1, name: acc.name } : acc, next);
}
function maybe(n: number, acc: number | undefined, next: Next<number | undefined>): number | undefined {
  if (n === 0) return acc === undefined ? undefined : acc + 0.25;
  return next(n - 1, acc === undefined ? n : undefined, next);
}
function nothing(n: number, acc: void, next: Next<void>): void {
  if (n === 0) {
    sink = "done";
    return;
  }
  return next(n - 1, acc, next);
}
sink = [sumDown, countDown, isEven, spell, build, maybe, nothing];

say(sumDown(deep, 0, sumDown) + 1, countDown(deep, 0, countDown) + 1, !isEven(deep, true, isEven), spell(deep, "", spell).length);
say(build(deep, { id: 0, name: "item" }, build).name, maybe(deep, undefined, maybe), maybe(deep + 1, undefined, maybe), nothing(deep, undefined, nothing), sink);
say(sumDown(0, 1, sumDown), countDown(0, 7.9, countDown), isEven(0, false, isEven), spell(0, "a", spell), build(0, { id: 3, name: "b" }, build), maybe(0, 1, maybe));

const asValues: ((n: number, acc: any, next: any) => unknown)[] = [sumDown, countDown, isEven, spell, build, maybe, nothing];
const starts: unknown[] = [0, 0, true, "", { id: 0, name: "item" }, undefined, undefined];
say(asValues.map((f, i) => f(deep + i, starts[i], f)));
say(asValues.map((f, i) => f(0, starts[i], f)));

function ping(n: number, acc: number, other: Next<number>): number {
  if (n === 0) return acc + 0.5;
  return other(n - 1, acc + 1, ping);
}
function pong(n: number, acc: number, other: Next<number>): number {
  if (n === 0) return acc - 0.5;
  return other(n - 1, acc + 2, pong);
}
const untypedPong: any = function (n: any, acc: any, other: any) {
  return n === 0 ? acc : other(n - 1, acc + 3, untypedPong);
};
sink = [ping, pong];
say(ping(deep, 0, pong), ping(deep + 1, 0, pong), pong(deep, 0, ping), ping(deep, 0, untypedPong), ping(deep + 1, 0, untypedPong));

class Steps {
  static one(v: number): number {
    return v + 1;
  }
  static half(v: number): number {
    return v / 2;
  }
}
function viaStatic(v: number, pad: number): number {
  if (pad < 0) sink = [pad, pad + 1, pad + 2, pad + 3, pad * 2, pad * 3, pad * 4, pad * 5, String(pad), -pad];
  return Steps.one(v);
}
function viaOtherStatic(v: number, pad: number): number {
  if (pad < 0) sink = [pad, pad + 1, pad + 2, pad + 3, pad * 2, pad * 3, pad * 4, pad * 5, String(pad), -pad];
  return Steps.half(v);
}
sink = [viaStatic, viaOtherStatic];
let total = 0;
for (let i = 0; i < 1000; i++) total += viaStatic(i, 1) + viaOtherStatic(i, 1);
say(total);
(Steps as any).one = function (v: number) {
  "use strict";
  return v <= 0 ? -0.5 : viaStatic(v - 1, 1);
};
say(viaStatic(deep, 1) * 2, (viaStatic as any)(deep, 1), [viaStatic].map(f => f(deep + 1, 1)));
(Steps as any).half = function (v: number) {
  "use strict";
  return v <= 0 ? -0.25 : (viaOtherStatic as any)(v - 1, 1);
};
say(viaOtherStatic(4, 1) * 2, [viaOtherStatic].map(f => f(4, 1)), [viaOtherStatic].map(f => f(deep, 1) + 1));

function sum3(a: number, b: number, c: number): number {
  return a + b + c;
}
function spreadInto(three: number[], pad: number): number {
  if (pad < 0) sink = [pad, pad + 1, pad + 2, pad + 3, pad * 2, pad * 3, pad * 4, pad * 5, String(pad), -pad];
  return sum3(...(three as [number, number, number]));
}
function largest(numbers: number[], pad: number): number {
  if (pad < 0) sink = [pad, pad + 1, pad + 2, pad + 3, pad * 2, pad * 3, pad * 4, pad * 5, String(pad), -pad];
  return Math.max(...numbers);
}
function applied(f: (...xs: number[]) => number, numbers: number[], n: number): number {
  if (n === 0) return numbers.length + 0.5;
  return f.apply(undefined, numbers);
}
sink = [spreadInto, largest, applied];
say(spreadInto([1, 2, 3.5], 1) + 1, largest([3, 1, 4, 1.5], 1) + 1, applied(sum3 as any, [1, 2, 3], 1) + 1, applied(sum3 as any, [1, 2], 0));
say(largest([], 1), [spreadInto, largest].map(f => f([7, 8, 9], 1)));

function spreadDown(args: [number, number], next: (...xs: any[]) => number): number {
  if (args[0] === 0) return args[1] + 0.5;
  return next(...[[args[0] - 1, args[1] + 1], next]);
}
function applyDown(n: number, acc: number, next: Function): number {
  if (n === 0) return acc + 0.5;
  return next.apply(undefined, [n - 1, acc + 1, next]);
}
sink = [spreadDown, applyDown];
say(spreadDown([deep, 0], spreadDown), applyDown(deep, 0, applyDown), (applyDown as any)(deep + 1, 0, applyDown));

function direct(n: number, acc: number, next: Next<number>): number {
  if (n === 0) return acc + 0.5;
  return viaDirect(n, acc, next);
}
function viaDirect(n: number, acc: number, next: Next<number>): number {
  if (n < 0) return -1;
  return next(n - 1, acc + 1, next);
}
sink = [direct, viaDirect];
say(direct(deep, 0, direct), viaDirect(deep, 0, direct), direct(deep, 0, viaDirect), [direct, viaDirect].map(f => f(deep, 0, direct)));

function nested(n: number): number {
  if (n === 0) return 0.5;
  return 1 + sumDown(3, nested(n - 1), sumDown);
}
say(nested(300));

function thrower(n: number, acc: number, next: Next<number>): number {
  if (n === 0) throw new RangeError("the end: " + acc);
  return next(n - 1, acc + 1, next);
}
sink = thrower;
for (const call of [() => thrower(deep, 0, thrower), () => sumDown(3, 0, thrower), () => [thrower].map(f => f(deep, 0, sumDown))]) {
  try {
    say(call());
  } catch (error) {
    say((error as Error).name, (error as Error).message);
  }
}

function wrong(n: number, acc: number, next: Next<number>): number {
  if (n === 0) return acc;
  return next(n - 1, acc, next);
}
const liar = ((n: number) => "not a number " + n) as unknown as Next<number>;
sink = wrong;
try {
  say((wrong as any)(1, 0, liar), [wrong].map(f => (f as any)(1, 0, liar)));
} catch (error) {
  say("a result of another kind:", (error as Error).constructor.name);
}

let many = 0;
for (let round = 0; round < 20000; round++) many += sumDown(round & 3, round, sumDown) + countDown(round & 1, round, countDown) + (isEven(round & 7, true, isEven) ? 1 : 0) + spell(round & 1, "a", spell).length;
say(many);
console.log(lines.join("\n"));
