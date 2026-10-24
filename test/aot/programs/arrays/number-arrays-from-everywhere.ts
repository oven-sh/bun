// Typed functions over `number[]` (two sums, a read, a chain of reads, a store, a loop of stores, push, includes, indexOf, map, a pattern) get arrays from every source: literals of whole numbers, of fractions and of variables, empty literals that are pushed into, JSON.parse, Array.from, `new Array(n)`, the methods of the library, holes, frozen and sealed arrays, one constant literal evaluated many times, own properties named -1 and 1.5, subclasses, other prototypes, another realm, a proxy. Whatever storage an array arrives with, every function answers as in plain Bun, the first time it sees the array and the second, and 0 and -0 stay apart.
// STATISTIC: ElementPresenceTestsPlaced >= 1
// STATISTIC: IntegerArrayConversionsPlaced >= 1
import vm from "node:vm";

function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function list(a: unknown[]): string {
  let text = "[";
  for (let i = 0; i < a.length; i++) text += (i > 0 ? " " : "") + (Object.hasOwn(a, i) ? show(a[i]) : "hole");
  text += "]";
  for (const key of Object.keys(a)) if (String(Number(key) >>> 0) !== key) text += " " + key + "=" + show((a as unknown as Record<string, unknown>)[key]);
  return Object.getPrototypeOf(a) === Array.prototype ? text : text + " with another prototype";
}

function sum(a: number[]): number {
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i];
  return total;
}

function sumOf(a: number[]): number {
  let total = 0;
  for (const value of a) total += value;
  return total;
}

function at(a: number[], i: number): number {
  return a[i];
}

function chase(a: number[], k: number): number {
  k = a[k];
  k = a[k];
  k = a[k];
  return k;
}

function put(a: number[], i: number, v: number): void {
  a[i] = v;
}

function scale(a: number[], by: number): void {
  for (let i = 0; i < a.length; i++) a[i] = a[i] * by;
}

function add(a: number[], v: number): number {
  return a.push(v);
}

function has(a: number[], v: number): boolean {
  return a.includes(v);
}

function where(a: number[], v: number): number {
  return a.indexOf(v);
}

function doubled(a: number[]): number[] {
  return a.map(value => value * 2);
}

function firstLessSecond(a: number[]): number {
  const [first, second] = a;
  return first - second;
}

let traps = "";
const logging: ProxyHandler<number[]> = {
  get(target, key, receiver) {
    traps += " get:" + String(key);
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    traps += " set:" + String(key);
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) {
    traps += " has:" + String(key);
    return Reflect.has(target, key);
  },
};

function attempt(run: () => string): string {
  let text: string;
  try {
    text = run();
  } catch (error) {
    text = "threw " + (error as Error).constructor.name;
  }
  if (traps !== "") text += " (traps:" + traps + ")";
  traps = "";
  return text;
}

// What the function answers or throws, and what the array is afterwards.
function outcome(a: number[], run: (a: number[]) => string): string {
  const text = attempt(() => run(a));
  return (text === "" ? "" : text + " ") + attempt(() => list(a));
}

const one = JSON.parse("1") as number;
const half = JSON.parse("0.5") as number;
const nan = Number(JSON.parse('"x"'));

function constant(): number[] {
  return [1, 2, 3];
}

function constantFractions(): number[] {
  return [0.5, 1.5, 2.5];
}

function rest(...values: number[]): number[] {
  return values;
}

function changed(a: number[], change: (a: number[]) => void): number[] {
  change(a);
  return a;
}

class Numbers extends Array<number> {}
class Padded extends Array<number> {}
(Padded.prototype as unknown as Record<string, number>)["1"] = 40;

const otherRealm = vm.createContext({});
const realmWithAnInheritedElement = vm.createContext({});
vm.runInContext("Array.prototype[1] = 20;", realmWithAnInheritedElement);

const makers: [string, () => number[]][] = [
  ["whole numbers", constant],
  ["fractions", constantFractions],
  ["whole numbers around a fraction", () => [1, 2.5, 3]],
  ["variables that hold whole numbers", () => [one, one + 1, one + 2]],
  ["variables that hold fractions", () => [half, half + 1, half + 2]],
  ["a variable that holds NaN", () => [nan, 2, 3]],
  ["NaN", () => [NaN, 2, 3]],
  ["numbers past 32 bits", () => [2147483647, 2147483648, -2147483649, 9007199254740991]],
  ["infinities", () => [Infinity, -Infinity, 1e308]],
  ["[-0]", () => [-0]],
  ["[0]", () => [0]],
  ["variables that hold 0 and -0", () => [one - one, -(one - one)]],
  ["empty", () => []],
  ["whole numbers pushed", () => changed([], a => (a.push(1), a.push(2), a.push(3)))],
  ["fractions pushed", () => changed([], a => (a.push(0.5), a.push(1.5), a.push(2.5)))],
  ["whole numbers and then a fraction pushed", () => changed([], a => (a.push(1), a.push(2), a.push(2.5)))],
  ["whole numbers stored one behind the other", () => changed([], a => ((a[0] = 1), (a[1] = 2), (a[2] = 3)))],
  ["JSON.parse", () => JSON.parse("[1,2,3]") as number[]],
  ["JSON.parse, fractions", () => JSON.parse("[0.5,1.5,2.5]") as number[]],
  ["JSON.parse, both", () => JSON.parse("[1,2.5,3]") as number[]],
  ["JSON.parse, -0", () => JSON.parse("[-0,0]") as number[]],
  ["JSON.parse, empty", () => JSON.parse("[]") as number[]],
  ["Array.from a length", () => Array.from({ length: 3 }, (_, i) => i)],
  ["Array.from a length, fractions", () => Array.from({ length: 3 }, (_, i) => i / 2)],
  ["Array.from a set", () => Array.from(new Set([1, 2, 3]))],
  ["Array.from bytes", () => Array.from(new Uint8Array([1, 2, 3]))],
  ["Array.from doubles", () => Array.from(new Float64Array([1, NaN, -0]))],
  ["Array.of", () => Array.of(1, 2, 3)],
  ["new Array(3).fill(0)", () => new Array<number>(3).fill(0)],
  ["new Array(3).fill(0.5)", () => new Array<number>(3).fill(0.5)],
  ["new Array(3)", () => new Array<number>(3)],
  ["new Array(3), one stored", () => changed(new Array<number>(3), a => (a[1] = 2))],
  ["new Array(1, 2, 3)", () => new Array<number>(1, 2, 3)],
  ["[1, , 3]", () => [1, , 3] as number[]],
  ["[0.5, , 2.5]", () => [0.5, , 2.5] as number[]],
  ["a hole made by delete", () => changed(JSON.parse("[1,2,3]") as number[], a => delete a[1])],
  ["a hole made by delete among fractions", () => changed(constantFractions(), a => delete a[1])],
  ["a length made longer", () => changed(constant(), a => (a.length = 5))],
  ["a length made shorter", () => changed(constant(), a => (a.length = 2))],
  ["an element past the end", () => changed(constant(), a => (a[6] = 7))],
  ["split and converted", () => "1,2,3".split(",").map(Number)],
  ["Object.values", () => Object.values({ a: 1, b: 2, c: 3 })],
  ["spread", () => [...constant()]],
  ["spread of a set", () => [...new Set([1, 2.5, 3])]],
  ["slice", () => constant().slice()],
  ["slice of a parsed array", () => (JSON.parse("[0,1,2,3,4]") as number[]).slice(1, 4)],
  ["concat", () => constant().concat(constantFractions())],
  ["filter", () => [1, 9, 2, 8, 3].filter(value => value < 5)],
  ["map to whole numbers", () => constant().map(value => value | 0)],
  ["map to fractions", () => constant().map(value => value / 4)],
  ["flat", () => [[1], [2, 3]].flat()],
  ["sorted", () => [3, 1, 2].sort((left, right) => left - right)],
  ["reversed", () => [3, 2, 1].reverse()],
  ["spliced out", () => [0, 1, 2, 3, 4].splice(1, 3)],
  ["rest parameters", () => rest(1, 2, 3)],
  ["rest parameters, fractions", () => rest(0.5, 1.5)],
  ["held a text once", () => changed(["x", 2, 3] as unknown[] as number[], a => (a[0] = 1))],
  ["held a fraction once", () => changed([0.5, 2, 3], a => (a[0] = 1))],
  ["frozen", () => changed(constant(), a => Object.freeze(a))],
  ["frozen fractions", () => changed(constantFractions(), a => Object.freeze(a))],
  ["frozen, parsed", () => changed(JSON.parse("[1,2,3]") as number[], a => Object.freeze(a))],
  ["Object.freeze([1, 2])", () => Object.freeze([1, 2]) as number[]],
  ["sealed", () => changed(constant(), a => Object.seal(a))],
  ["not extensible", () => changed(constant(), a => Object.preventExtensions(a))],
  ["a length that is read-only", () => changed(constant(), a => Object.defineProperty(a, "length", { writable: false }))],
  ["own properties -1 and 1.5", () => changed(constant(), a => (((a as unknown as Record<string, number>)["-1"] = 10), ((a as unknown as Record<string, number>)["1.5"] = 20)))],
  ["own properties -1 and 1.5 stored by number", () => changed(constantFractions(), a => ((a[-1] = 10), (a[1.5] = 20)))],
  ["own properties NaN and 4294967295", () => changed(constant(), a => ((a[NaN] = 30), (a[4294967295] = 40)))],
  ["an own name", () => changed(constant(), a => ((a as unknown as Record<string, number>).name = 6))],
  ["an own getter at 1", () => changed(constant(), a => Object.defineProperty(a, 1, { get: () => 50, enumerable: true, configurable: true }))],
  ["a read-only element at 1", () => changed(constant(), a => Object.defineProperty(a, 1, { value: 2.5, writable: false, enumerable: true, configurable: true }))],
  ["was sparse", () => changed(constant(), a => ((a[1000000] = 4), (a.length = 4)))],
  ["a subclass", () => changed(new Numbers(), a => a.push(1, 2, 3))],
  ["a subclass, fractions", () => changed(new Numbers(), a => a.push(0.5, 1.5, 2.5))],
  ["a subclass, from", () => Numbers.from([1, 2, 3])],
  ["a subclass, of", () => Numbers.of(1, 2, 3)],
  ["a subclass with an element on its prototype", () => changed(new Padded(), a => (a.push(1, 2, 3), delete a[1]))],
  ["a hole over another prototype's element", () => changed([1, , 3] as number[], a => Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: 30 }))],
  ["a hole among fractions over another prototype's element", () => changed([0.5, , 2.5] as number[], a => Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: 30.5 }))],
  ["another prototype with elements past the end", () => changed(constant(), a => Object.setPrototypeOf(a, { __proto__: Array.prototype, 3: 60, "-1": 70, "1.5": 80 }))],
  ["another realm", () => vm.runInContext("[1, 2, 3]", otherRealm) as number[]],
  ["another realm, fractions", () => vm.runInContext("[0.5, 1.5, 2.5]", otherRealm) as number[]],
  ["another realm, a hole", () => vm.runInContext("[1, , 3]", otherRealm) as number[]],
  ["another realm, a hole over an inherited element", () => vm.runInContext("[1, , 3]", realmWithAnInheritedElement) as number[]],
  ["a proxy", () => new Proxy([1, 2, 3], logging) as number[]],
  ["a proxy of fractions", () => new Proxy([0.5, 1.5, 2.5], logging) as number[]],
  ["a proxy of a hole", () => new Proxy([1, , 3] as number[], logging) as number[]],
];

const keys = [0, 1, 2, 3, -1, 1.5, -0, NaN, 4294967295, 4294967296];
const places: [string, (a: number[]) => number][] = [
  ["0", () => 0],
  ["1", () => 1],
  ["the length", a => a.length],
  ["the length + 2", a => a.length + 2],
  ["-1", () => -1],
  ["1.5", () => 1.5],
  ["-0", () => -0],
];
const values = [7, 0.5, -0, nan];

function exercise(name: string, make: () => number[], lines: string[]): void {
  const tell = (what: string, run: () => string): void => void lines.push(name + " | " + what + ": " + attempt(run));
  tell("summed", () => {
    const a = make();
    return show(sum(a)) + " " + show(sum(a)) + " " + show(sumOf(a)) + " " + show(sumOf(a)) + " " + list(a);
  });
  tell("summed by for-of first", () => {
    const a = make();
    return show(sumOf(a)) + " " + show(sum(a)) + " " + list(a);
  });
  tell("read", () => {
    const a = make();
    let text = "";
    for (const key of keys) text += show(at(a, key)) + " ";
    for (const key of keys) text += show(at(a, key)) + " ";
    return text + list(a);
  });
  tell("chased", () => {
    const a = make();
    return show(chase(a, 0)) + " " + show(chase(a, 1)) + " " + show(chase(a, 2)) + " " + show(chase(a, 1.5)) + " " + show(chase(a, -1));
  });
  for (const [label, place] of places) {
    tell("stored at " + label, () => values.map(value => outcome(make(), a => (put(a, place(a), value), show(sum(a))))).join(" ; "));
  }
  tell("summed, then stored into", () =>
    outcome(make(), a => {
      const before = sum(a);
      put(a, 0, 8);
      put(a, 1, 8.5);
      return show(before) + " " + show(sum(a));
    }),
  );
  tell("scaled", () => [2, 0.5, -1, nan].map(by => outcome(make(), a => (scale(a, by), ""))).join(" ; "));
  tell("pushed into", () => values.map(value => outcome(make(), a => add(a, value) + " " + add(a, 1) + " " + show(sum(a)))).join(" ; "));
  tell("searched", () => {
    const a = make();
    let text = "";
    for (const value of [1, 2, 3, 0, -0, 0.5, 2.5, nan, 20, 30, 40, 50, Infinity, 2147483648]) text += (has(a, value) ? "y" : "n") + where(a, value) + " ";
    return text + (has(a, undefined as unknown as number) ? "y" : "n") + where(a, undefined as unknown as number);
  });
  tell("summed, then searched", () => {
    const a = make();
    return show(sum(a)) + " " + has(a, 3) + " " + where(a, 3) + " " + has(a, 2.5) + " " + where(a, 2.5) + " " + has(a, nan);
  });
  tell("doubled", () => {
    const a = make();
    return list(doubled(a)) + " " + list(doubled(doubled(a))) + " " + list(a);
  });
  tell("taken apart", () => {
    const a = make();
    return show(firstLessSecond(a)) + " " + show(firstLessSecond(a));
  });
}

function exerciseAll(): string[] {
  const lines: string[] = [];
  for (const [name, make] of makers) exercise(name, make, lines);
  return lines;
}

const firstTime = exerciseAll();
for (const line of firstTime) console.log(line);
const secondTime = exerciseAll();
let differences = 0;
for (let i = 0; i < firstTime.length; i++) {
  if (firstTime[i] === secondTime[i]) continue;
  differences++;
  console.log("the second time: " + secondTime[i]);
}
console.log("lines that differ the second time: " + differences);

// One array that every function sees again and again, and one literal that many arrays come from.
const shared: number[] = [4, 5, 6];
const parsed = JSON.parse("[4,5,6]") as number[];
for (const [name, a] of [["declared", shared], ["parsed", parsed]] as [string, number[]][]) {
  console.log(name + ": " + show(sum(a)) + " " + show(at(a, 2)) + " " + show(sumOf(a)) + " " + list(a));
  put(a, 0, 40);
  console.log(name + ": " + show(sum(a)) + " " + show(at(a, 0)) + " " + has(a, 40) + " " + list(a));
  put(a, 1, 0.25);
  console.log(name + ": " + show(sum(a)) + " " + show(at(a, 1)) + " " + where(a, 0.25) + " " + list(a));
  console.log(name + ": " + add(a, 7) + " " + show(sum(a)) + " " + list(a));
  put(a, 2, nan);
  console.log(name + ": " + show(sum(a)) + " " + show(at(a, 2)) + " " + has(a, nan) + " " + where(a, nan) + " " + list(a));
  put(a, 2, -0);
  console.log(name + ": " + show(sum(a)) + " " + show(at(a, 2)) + " " + show(1 / at(a, 2)) + " " + list(a));
  put(a, 8, 1);
  console.log(name + ": " + show(sum(a)) + " " + show(at(a, 6)) + " " + list(a) + " " + list(doubled(a)));
}
const copies = [constant(), constant(), constant()];
put(copies[0], 0, 0.5);
add(copies[1], 4);
console.log(copies.map(list).join(" ") + " " + list(constant()) + " " + show(sum(constant())) + " " + list(constantFractions()));
