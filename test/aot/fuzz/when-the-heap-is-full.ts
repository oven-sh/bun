// A program keeps objects alive until no more fit, catches the error at every level on the way up, gives a little back each time and does real work there: so that every allocation inside the work meets a full heap once.
//
//   kept      object literals, instances, nested objects, closures, texts, small arrays, numbers with a fraction, big integers, maps, sets, promises, async functions that wait, generators that have begun, bound functions, symbols, dates,
//             regular expressions, errors, proxies, typed arrays, buffers, weak references, arguments, wrapped numbers, private fields, subclasses, objects and arrays that grow, spreads, rest parameters, classes, objects each of a shape of its own;
//             or whatever one built-in makes by itself: JSON.parse, structuredClone, Object.entries, split, matchAll, a spread of each element, Array.from over a map, Object.fromEntries
//   made      in a loop that calls nothing, in a function, in functions that call themselves, in callbacks of built-ins, constructors, field initializers, getters, generators, spreads, comparers, replacers, revivers, toString, proxies,
//             text that becomes code at run time, async functions, handlers of promises, timers
//   caught    and thrown on; in a finally; thrown anew; swallowed, and filled again from there; at 1 to 200 levels
//   given back  nothing, one small object a level, one part a level, one part at every third level, half at the first level, everything at the first level
//   work      the pieces of work-on-the-way-up.ts
//
// The objects of a compiled program live in one range of address space: BUN_JSC_markedBlockCageSizeInMB=64 makes it small, BUN_JSC_structureHeapSizeInKB the one for shapes. Plain Bun has no such end: there, and wherever the range is large, a fill ends
// with a RangeError of the program's own after more objects than fit into 64 MB. So nothing that is printed depends on where the end is: what was kept must be whole, work that runs through must answer what it answered at the top, work that fails
// must fail with a RangeError, and afterward everything must work as before. Where no error can be thrown a compiled program stops with "FATAL: out of memory": that is meant, and says nothing.
import type { Random } from "./random";
import { callbacks, prelude, probes } from "./work-on-the-way-up";

export const beside = `function add(a: number, b: number): number {
  return a + b;
}
let gate: Promise<void> = Promise.resolve();
async function waits(i: number): Promise<number> {
  const held = { i };
  await gate;
  return held.i + 1;
}
function* countsFrom(i: number): Generator<number, void, unknown> {
  const held = [i];
  yield held[0];
  yield held[0] + 1;
}
function begun(i: number): Generator<number, void, unknown> {
  const generator = countsFrom(i);
  generator.next();
  return generator;
}
class Hidden {
  #i: number;
  extra = [0];
  constructor(i: number) {
    this.#i = i;
  }
  get value(): number {
    return this.#i + this.extra[0];
  }
}
class Deeper extends Point {
  z: number;
  constructor(i: number) {
    super(i, 1);
    this.z = i;
  }
}
const keys = ["k0", "k1", "k2", "k3", "k4", "k5", "k6", "k7", "k8", "k9", "k10", "k11"];
function grown(i: number): Record<string, number> {
  const object: Record<string, number> = {};
  for (const key of keys) object[key] = i;
  return object;
}
function stretched(i: number): number[] {
  const list: number[] = [];
  for (let at = 0; at < 20; at++) list.push(i + at);
  return list;
}
const pair = { a: 1, b: 2 };
const anchor = new Point(1, 2);
// The error may come at the entry of the function that a timer calls, where nobody catches it. Whoever waits for that timer hears of it here: a top-level await that never settles never ends.
let rejectWhoWaits: ((error: unknown) => void) | undefined;
process.on("uncaughtException", (error: unknown) => {
  const reject = rejectWhoWaits;
  rejectWhoWaits = undefined;
  if (reject) reject(error);
  else console.log("strange: nobody caught " + (error instanceof RangeError ? "the error of a full heap" : String(error)));
});
let reserve: unknown[] | null = null;
let spare: unknown[] = [];
function ballast(): unknown[] {
  const all: unknown[] = [];
  for (let i = 0; i < 30000; i++) all.push({ i }, [i, i], "b" + i, () => i, { a: i, b: i, c: i, d: i, e: i, f: i });
  return all;
}
function smallThings(): unknown[] {
  const all: unknown[] = [];
  for (let i = 0; i < 400; i++) all.push(i % 4 === 0 ? { i } : i % 4 === 1 ? [i, i, i, i] : i % 4 === 2 ? "s" + i : { a: i, b: i, c: i, d: i, e: i, f: i, g: i, h: i });
  return all;
}
`;

// `i` is the number of the object, `x` the object.
type Kind = readonly [name: string, type: string, make: string, holds: string, most: number];
const light = 5_000_000;
const heavy = 1_600_000;
export const kinds: readonly Kind[] = [
  ["literals", "{ a: number; b: number }", "{ a: i, b: i * 2 + 1 }", "x.a === i && x.b === i * 2 + 1", light],
  ["instances", "Point", "new Point(i, 1)", "x.sum === i + 1", light],
  ["nested-objects", "{ inner: { i: number }; list: number[] }", "{ inner: { i }, list: [i] }", "x.inner.i === i && x.list[0] === i && x.list.length === 1", heavy],
  ["closures", "() => number", "() => i", "x() === i", light],
  ["texts", "string", `"n" + i`, `x === "n" + i`, light],
  ["small-arrays", "number[]", "[i, i + 1, i + 2]", "x.length === 3 && x[0] === i && x[2] === i + 2", light],
  ["numbers-with-a-fraction", "unknown", "i + 0.5", "x === i + 0.5", light],
  ["big-integers", "bigint", "BigInt(i) << 64n", "x >> 64n === BigInt(i)", heavy],
  ["maps", "Map<number, number>", "new Map([[i, i]])", "x.get(i) === i && x.size === 1", heavy],
  ["sets", "Set<number>", "new Set([i])", "x.has(i) && x.size === 1", heavy],
  ["promises", "Promise<number>", "Promise.resolve(i)", "(await x) === i", heavy],
  ["functions-that-wait", "Promise<number>", "waits(i)", "(await x) === i + 1", heavy],
  ["generators-that-have-begun", "Generator<number, void, unknown>", "begun(i)", "x.next().value === i + 1", heavy],
  ["bound-functions", "(more: number) => number", "add.bind(null, i)", "x(1) === i + 1", heavy],
  ["symbols", "symbol", "Symbol()", `typeof x === "symbol"`, light],
  ["dates", "Date", "new Date(i)", "x.getTime() === i", light],
  ["regular-expressions", "RegExp", "/a+/g", "x.lastIndex === 0 && x.global", heavy],
  ["errors", "Failure", "new Failure(i)", "x.code === i", heavy],
  ["proxies", "{ i: number }", "new Proxy({ i }, {})", "x.i === i", heavy],
  ["typed-arrays", "Uint32Array", "new Uint32Array([i, i + 1])", "x[0] === i && x[1] === i + 1 && x.length === 2", heavy],
  ["buffers", "ArrayBuffer", "new ArrayBuffer(8)", "x.byteLength === 8", heavy],
  ["weak-references", "WeakRef<Point>", "new WeakRef(anchor)", "x.deref() === anchor", heavy],
  ["arguments", "IArguments", "(function (..._all: number[]) { return arguments; })(i, i)", "x.length === 2 && x[1] === i", heavy],
  ["wrapped-numbers", "Number", "new Number(i)", "x.valueOf() === i", light],
  ["private-fields", "Hidden", "new Hidden(i)", "x.value === i", heavy],
  ["subclasses", "Deeper", "new Deeper(i)", "x.sum + x.z === 2 * i + 1", light],
  ["objects-that-grow", "Record<string, number>", "grown(i)", "x.k0 === i && x.k11 === i", heavy],
  ["arrays-that-grow", "number[]", "stretched(i)", "x.length === 20 && x[19] === i + 19", heavy],
  ["spreads", "{ a: number; b: number; c: number }", "{ ...pair, c: i }", "x.a === 1 && x.c === i", light],
  ["rest-parameters", "number[]", "((...rest: number[]) => rest)(i, i)", "x.length === 2 && x[1] === i", light],
  ["classes", "{ at: number }", "class { static at = i; }", "x.at === i", 300_000],
  ["shapes-of-their-own", "Record<string, number>", `{ ["p" + i]: i }`, `x["p" + i] === i`, 400_000],
];

// What a built-in makes by itself, `size` things at a time.
type Whole = readonly [name: string, type: string, beside: (id: number, size: number) => string, make: (id: number) => string, holds: string, most: number];
const wholes: readonly Whole[] = [
  ["json-parse", "{ a: number; b: number[] }", (id, size) => `const text${id} = "[" + '{"a":1,"b":[2]},'.repeat(${size - 1}) + '{"a":1,"b":[2]}]';`, id => `JSON.parse(text${id})`, "x.a === 1 && x.b[0] === 2", heavy],
  ["structured-clone", "{ a: number; b: number[] }", (id, size) => `const sample${id} = Array.from({ length: ${size} }, () => ({ a: 1, b: [2] }));`, id => `structuredClone(sample${id})`, "x.a === 1 && x.b[0] === 2", heavy],
  ["object-entries", "[string, number]", (id, size) => `const wide${id}: Record<string, number> = {};\nfor (let i = 0; i < ${size}; i++) wide${id}["k" + i] = 7;`, id => `Object.entries(wide${id})`, "x.length === 2 && x[1] === 7", heavy],
  ["split", "string", (id, size) => `const text${id} = "ab,".repeat(${size - 1}) + "ab";`, id => `text${id}.split(",")`, `x === "ab"`, light],
  ["match-all", "RegExpExecArray", (id, size) => `const text${id} = "12 ".repeat(${size});`, id => `[...text${id}.matchAll(/\\d+/g)]`, `x[0] === "12"`, heavy],
  ["a-spread-of-each", "{ a: number; b: number }", (id, size) => `const sample${id} = Array.from({ length: ${size} }, () => ({ a: 1, b: 2 }));`, id => `sample${id}.map(each => ({ ...each }))`, "x.a === 1 && x.b === 2", light],
  ["array-from-a-map", "[number, number]", (id, size) => `const table${id} = new Map<number, number>();\nfor (let i = 0; i < ${size}; i++) table${id}.set(i, 7);`, id => `Array.from(table${id})`, "x.length === 2 && x[1] === 7", heavy],
  ["texts-of-numbers", "string", (id, size) => `const numbers${id} = Array.from({ length: ${size} }, (_, at) => at + 1000000);`, id => `numbers${id}.map(String)`, "x.length === 7", light],
];

// Each makes `size` objects, pushes them on `items` and counts them in `made`. `MAKE` stands for the expression, which reads `i`.
type Road = readonly [name: string, fill: (id: number, size: number) => string, beside?: (id: number, size: number) => string, most?: number];
const one = (id: number) => `made${id}++`;
const roads: readonly Road[] = [
  ["a-loop", (id, size) => `for (let at = 0; at < ${size}; at++) {\n      const i = made${id};\n      items.push(MAKE);\n      ${one(id)};\n    }`],
  ["a-function", (id, size) => `for (let at = 0; at < ${size}; at++) {\n      items.push(make${id}(made${id}));\n      ${one(id)};\n    }`, id => `function make${id}(i: number): TYPE {\n  return MAKE;\n}`],
  ["functions-that-call-themselves", (id, size) => `build${id}(items, ${Math.round(Math.log2(size))});`, id => `function build${id}(items: Array<TYPE>, depth: number): void {\n  if (depth === 0) {\n    const i = made${id};\n    items.push(MAKE);\n    ${one(id)};\n    return;\n  }\n  build${id}(items, depth - 1);\n  build${id}(items, depth - 1);\n}`],
  ["map", id => `const from = made${id};\n    part.items = base${id}.map((_, at) => {\n      const i = from + at;\n      return MAKE;\n    });\n    made${id} += part.items.length;`, (id, size) => `const base${id}: number[] = new Array(${size}).fill(0);`],
  ["array-from", (id, size) => `const from = made${id};\n    part.items = Array.from({ length: ${size} }, (_, at) => {\n      const i = from + at;\n      return MAKE;\n    });\n    made${id} += part.items.length;`],
  ["for-each", id => `base${id}.forEach(() => {\n      const i = made${id};\n      items.push(MAKE);\n      ${one(id)};\n    });`, (id, size) => `const base${id}: number[] = new Array(${size}).fill(0);`],
  ["a-constructor", (id, size) => `for (let at = 0; at < ${size}; at++) {\n      items.push(new Maker${id}(made${id}).result);\n      ${one(id)};\n    }`, id => `class Maker${id} {\n  result: TYPE;\n  constructor(i: number) {\n    this.result = MAKE;\n  }\n}`],
  ["a-field-initializer", (id, size) => `for (let at = 0; at < ${size}; at++) {\n      items.push(new Field${id}().result);\n      ${one(id)};\n    }`, id => `class Field${id} {\n  result: TYPE = ((i: number): TYPE => MAKE)(made${id});\n}`],
  ["a-getter", (id, size) => `for (let at = 0; at < ${size}; at++) {\n      items.push(getter${id}.next);\n      ${one(id)};\n    }`, id => `const getter${id} = {\n  get next(): TYPE {\n    const i = made${id};\n    return MAKE;\n  },\n};`],
  ["a-generator", (id, size) => `for (const each of makes${id}(made${id}, ${size})) {\n      items.push(each);\n      ${one(id)};\n    }`, id => `function* makes${id}(from: number, count: number): Generator<TYPE, void, unknown> {\n  for (let at = 0; at < count; at++) {\n    const i = from + at;\n    yield MAKE;\n  }\n}`],
  ["a-spread", (id, size) => `part.items = [...makes${id}(made${id}, ${size})];\n    made${id} += part.items.length;`, id => `function* makes${id}(from: number, count: number): Generator<TYPE, void, unknown> {\n  for (let at = 0; at < count; at++) {\n    const i = from + at;\n    yield MAKE;\n  }\n}`],
  ["a-comparer", (id, size) => `for (let at = 0; at < ${size}; at++)\n      [2, 1].sort((a, b) => {\n        const i = made${id};\n        items.push(MAKE);\n        ${one(id)};\n        return a - b;\n      });`, undefined, 2],
  ["a-replacer", id => `letters${id}.replace(/a/g, () => {\n      const i = made${id};\n      items.push(MAKE);\n      ${one(id)};\n      return "";\n    });`, (id, size) => `const letters${id} = "a".repeat(${size});`],
  ["a-reviver", id => `JSON.parse(zeros${id}, (key, value) => {\n      if (key === "") return value;\n      const i = made${id};\n      items.push(MAKE);\n      ${one(id)};\n      return value;\n    });`, (id, size) => `const zeros${id} = "[" + "0,".repeat(${size - 1}) + "0]";`],
  ["to-string", (id, size) => `for (let at = 0; at < ${size}; at++) void ("" + text${id});`, id => `let into${id}: Array<TYPE> = [];\nconst text${id} = {\n  toString(): string {\n    const i = made${id};\n    into${id}.push(MAKE);\n    ${one(id)};\n    return "";\n  },\n};`],
  ["a-proxy", (id, size) => `for (let at = 0; at < ${size}; at++) {\n      items.push(proxy${id}[made${id}]);\n      ${one(id)};\n    }`, id => `const proxy${id}: Record<number, TYPE> = new Proxy({}, {\n  get: (_target, key) => {\n    const i = Number(key as string);\n    return MAKE;\n  },\n});`, 2],
  ["text-at-run-time", (id, size) => `text${id}(items, ${size});`, id => `function make${id}(): TYPE {\n  const i = made${id};\n  return MAKE;\n}\nfunction count${id}(): void {\n  ${one(id)};\n}\nconst text${id}: (items: Array<TYPE>, count: number) => void = new Function("make", "counted", "return function (items, count) { for (let at = 0; at < count; at++) { items.push(make()); counted(); } }")(make${id}, count${id});`],
];

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude, beside];
  // These catch a RangeError inside and answer with it.
  const used = [...random.sample(callbacks, random.between(1, 3)), ...random.sample(probes.filter(([name]) => name !== "errors-of-every-kind"), random.between(1, 3))];
  used.forEach(([, body], at) => text.push(`function probe${at}(): unknown {\n  ${body}\n}`));
  text.push(`const expected = [${used.map((_, at) => `probe${at}()`).join(", ")}];`);
  const names: string[] = [];
  const cases = random.between(1, 2);
  for (let id = 1; id <= cases; id++) {
    const whole = random.chance(0.2) ? pick(wholes) : undefined;
    const kind = pick(kinds);
    const road = pick(roads);
    const [kindName, type, holds] = whole ? [whole[0], whole[1], whole[4]] : [kind[0], kind[1], kind[3]];
    const most = Math.ceil((whole ? whole[5] : kind[4]) / (whole ? 1 : (road[3] ?? 1)));
    const waiting = pick(["", "", "", "an-async-function", "a-handler-of-a-promise", "a-timer"]);
    const isAsync = waiting !== "";
    const size = waiting === "a-timer" ? 8192 : pick([64, 1024, 1024, 8192]);
    const [maybeAsync, maybeAwait, result] = isAsync ? ["async ", "await ", "Promise<void>"] : ["", "", "void"];
    const written = (template: string) => template.replaceAll("MAKE", kind[2]).replaceAll("TYPE", type);
    const levels = pick([1, 2, 5, 20, 200]);
    const mine = random.sample(used.map((_, at) => at), random.between(1, 3));
    const variables = pick([0, 0, 2, 6]);
    const [givenName, given] = pick<readonly [string, string]>([
      ["nothing", ""],
      ["one-small-object-a-level", "spare.pop();"],
      ["one-small-object-a-level", "spare.pop();"],
      ["one-part-a-level", `parts${id}.pop();`],
      ["one-part-a-level", `parts${id}.pop();`],
      ["one-part-at-every-third-level", `if (level % 3 === 0) parts${id}.pop();`],
      ["half-at-the-first-level", `if (!gave${id}) parts${id}.length >>= 1;\n  gave${id} = true;`],
      ["everything-at-the-first-level", `parts${id}.length = 0;`],
    ]);
    const down = `${maybeAwait}up${id}(level - 1)`;
    const stillThere = Array.from({ length: variables }, (_, at) => `\n    if (${[`v${at} !== level + ${at}.5`, `v${at}.length < 2`, `v${at}[0] !== level`, `v${at}.level !== level`][at % 4]}) wrong.add("${id} a variable");`).join("");
    const after = `give${id}(level);\n    work${id}(level);${stillThere}`;
    const [caughtName, caught] = pick<readonly [string, string]>([
      ["thrown-on", `try {\n    ${down};\n  } catch (error) {\n    ${after}\n    throw error;\n  }`],
      ["thrown-on", `try {\n    ${down};\n  } catch (error) {\n    ${after}\n    throw error;\n  }`],
      ["in-a-finally", `try {\n    ${down};\n  } finally {\n    ${after}\n  }`],
      ["thrown-anew", `try {\n    ${down};\n  } catch {\n    ${after}\n    anew();\n  }`],
      ["filled-again", `try {\n    ${down};\n  } catch (error) {\n    ${after}\n    if (again${id}++ >= 3) throw error;\n    ${down};\n  }`],
    ]);
    names.push(`${kindName}--${whole ? "by-a-built-in" : road[0]}${isAsync ? "--" + waiting : ""}--${caughtName}--${levels}-levels--${givenName}--${size}-a-part--${mine.map(at => used[at][0]).join("+")}`);
    text.push(`// ${id}: ${names[names.length - 1]}`);
    text.push(`type Part${id} = { first: number; items: Array<${type}>; open: () => void; isCutShort: boolean };
let parts${id}: Part${id}[] = [];
let made${id} = 0;
let worked${id} = 0;
let again${id} = 0;
let gave${id} = false;
let torn${id} = 0;
// The part that was being made when the error came holds as many objects as were counted, or one more: the error may come between the two.
function seal${id}(): void {
  const last = parts${id}[parts${id}.length - 1];
  if (last === undefined || last.isCutShort || last.items.length === ${size}) return;
  const ahead = last.first + last.items.length - made${id};
  if (ahead !== 0 && ahead !== 1) torn${id}++;
  last.isCutShort = true;
}`);
    if (whole) text.push(whole[2](id, size));
    else if (road[2]) text.push(written(road[2](id, size)));
    const opens = !whole && kind[0] === "functions-that-wait";
    const fillsOnePart = whole ? `part.items = ${whole[3](id)};\n    made${id} += part.items.length;` : written(road[1](id, size));
    const onePart = `const items: Array<${type}> = [];
    ${opens ? `const { promise, resolve } = Promise.withResolvers<void>();\n    gate = promise;\n    ` : ""}const part: Part${id} = { first: made${id}, items, open: ${opens ? "resolve" : "nothing"}, isCutShort: false };
    parts${id}.push(part);${!whole && road[0] === "to-string" ? `\n    into${id} = items;` : ""}
    ${fillsOnePart}`;
    if (waiting === "a-handler-of-a-promise" || waiting === "a-timer") text.push(`function part${id}(): void {\n    ${onePart}\n}`);
    text.push(`${maybeAsync}function fill${id}(): ${result} {
  seal${id}();
  for (;;) {
    if (made${id} >= ${most}) enough();
    ${
      waiting === "a-handler-of-a-promise"
        ? `await Promise.resolve().then(part${id});`
        : waiting === "a-timer"
          ? `await new Promise<void>((resolve, reject) => {\n      rejectWhoWaits = reject;\n      setTimeout(() => settle(part${id}, resolve, reject), 0);\n    });`
          : `${onePart}${isAsync ? "\n    await null;" : ""}`
    }
  }
}
function give${id}(level: number): void {
  ${given}
}
function work${id}(level: number): void {
  if (worked${id} >= 60) return;
  worked${id}++;
${mine.map(at => `  try {\n    if (probe${at}() !== expected[${at}]) wrong.add("${id} ${used[at][0]}");\n  } catch (error) {\n    note("${id} ${used[at][0]}", error);\n  }`).join("\n")}
}
${maybeAsync}function up${id}(level: number): ${result} {
  if (level === 0) return fill${id}();
  ${Array.from({ length: variables }, (_, at) => `const v${at} = ${[`level + ${at}.5`, `"v" + level`, `[level, ${at}]`, `{ level }`][at % 4]};`).join("\n  ")}
  ${caught}
}
async function check${id}(): Promise<string> {
  seal${id}();
  let broken = 0;
  let short = 0;
  for (const part of parts${id}) {
    part.open();
    if (part.items.length !== ${size} && !part.isCutShort) short++;
    for (let at = 0; at < part.items.length; at++) {
      const x = part.items[at];
      const i = part.first + at;
      if (!(${holds})) broken++;
    }
  }
  return torn${id} + short + broken ? " BROKEN: " + torn${id} + " not as counted, " + short + " short, " + broken + " objects" : " whole";
}
async function run${id}(): Promise<string> {
  let line = "${id}";
  for (let round = 0; round < ${pick([1, 2, 3])}; round++) {
    parts${id} = [];
    made${id} = worked${id} = again${id} = torn${id} = 0;
    gave${id} = false;
    let thrown: unknown;
    try {
      // The collector may still see what the last round kept.
      reserve = ballast();
      spare = smallThings();
      await up${id}(${levels});
    } catch (error) {
      reserve = null;
      thrown = error;
    }
    line += thrown instanceof RangeError ? " full" : " thrown " + String(thrown);
    line += await check${id}();
  }
  parts${id} = [];
  return line;
}`);
  }
  text.push(`function enough(): never {
  throw new RangeError("enough");
}
function anew(): never {
  throw new RangeError("anew");
}
function settle(run: () => void, resolve: () => void, reject: (error: unknown) => void): void {
  try {
    run();
  } catch (error) {
    return reject(error);
  }
  resolve();
}`);
  text.push(Array.from({ length: cases }, (_, at) => `console.log(await run${at + 1}());`).join("\n"));
  text.push(`// The error may still come here, behind the last fill.
for (let tries = 0; tries < 8; tries++) {
  try {
    await new Promise(resolve => setTimeout(resolve, 5));
    break;
  } catch (error) {
    if (!(error instanceof RangeError)) strange.add("behind the last fill");
    (globalThis as any).Bun.gc(true);
  }
}
console.log("strange: " + [...strange].sort().join(", "));
console.log("wrong: " + [...wrong].sort().join(", "));
console.log("afterward: " + [${used.map((_, at) => `probe${at}()`).join(", ")}].map((answer, at) => (answer === expected[at] ? "as before" : "ANOTHER")).join(", "));`);
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
