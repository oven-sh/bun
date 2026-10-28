// `list[key]` on a known array or typed array compiles to an element access: the key is expected to be an index and is tested,
// undefined and null receivers are handled first, and a tuple has an array's members. Anything that fails a test falls back to a
// lookup by key, which is what plain Bun always does: a numeric string, a negative number, a fraction, "length", an array in an
// unusual state, or a value that isn't an array at all.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { buildFlags, compileCommand, runtimeEnvironment } from "./harness/flags";
import { built, slot, spawned, told, wanted, withoutCoreDump } from "./run-programs";
import { describe, test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots: [join(import.meta.dir, "..", "..", "packages")],
    types: ["bun-types"],
  },
});

// --aot has its own wording for some TypeErrors, so only an error's name is printed.
const helpers = `function show(value: unknown): string {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return Array.isArray(value) ? "[" + value.join() + "]" : Object.prototype.toString.call(value);
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value));
}
function attempt(label: string, action: () => unknown): void {
  let outcome: string;
  try {
    outcome = show(action());
  } catch (error) {
    outcome = (error as Error).name;
  }
  console.log(label + ": " + outcome);
}
function nameOfError(action: () => unknown): unknown {
  try {
    return action();
  } catch (error) {
    return (error as Error).name;
  }
}
`;
const typeScript = (text: string) => helpers + text + "export {};\n";

const keys = `const keys: unknown[] = [
  0, 1, 2, 3, -1, 1.5, -0, NaN, Infinity, 2147483647, 2147483648, 4294967294, 4294967295, 4294967296,
  "0", "1", "01", "1.0", "-1", "-0", "1.5", "1e0", " 1", "length", "push", "missing", "",
  true, null, undefined, Symbol.iterator, 1n, [1], { toString() { return "2"; } },
];
`;

// Values passed where a `number[]` is expected. The ones without `as any` really are arrays of numbers.
const receivers: Record<string, string> = {
  "an array": `[1, 2, 3]`,
  "an array of fractions": `[1.5, 2.5, 3.5]`,
  "an empty array": `[]`,
  "a frozen array": `(() => { const list = [1, 2, 3]; Object.freeze(list); return list; })()`,
  "a sealed array": `(() => { const list = [1, 2, 3]; Object.seal(list); return list; })()`,
  "a non-extensible array": `(() => { const list = [1, 2, 3]; Object.preventExtensions(list); return list; })()`,
  "an array with a getter element": `(() => { const list = [1, 2, 3]; Object.defineProperty(list, 1, { get() { return 20; }, set() {}, configurable: true }); return list; })()`,
  "an array with a read-only element": `(() => { const list = [1, 2, 3]; Object.defineProperty(list, 1, { value: 20, writable: false }); return list; })()`,
  "an array with a read-only length": `(() => { const list = [1, 2, 3]; Object.defineProperty(list, "length", { writable: false }); return list; })()`,
  "a sparse array": `(() => { const list: number[] = []; list[100000] = 1; list[1] = 2; return list; })()`,
  "an array with a deleted element": `(() => { const list = [1, 2, 3]; delete list[1]; return list; })()`,
  "an array with a hole and a prototype that has the index": `(() => { const list = [1, 2, 3]; delete list[1]; Object.setPrototypeOf(list, Object.create(Array.prototype, { 1: { value: 20, writable: true, configurable: true } })); return list; })()`,
  "an array with a null prototype": `(() => { const list = [1, 2, 3]; Object.setPrototypeOf(list, null); return list; })()`,
  "an array with an extra property": `(() => { const list = [1, 2, 3]; (list as any).extra = 4; return list; })()`,
  "an Array subclass instance": `new (class List extends Array<number> {})(1, 2, 3)`,
  "an array of strings": `["a", "b", "c"] as any`,
  "an array with a hole": `[1, , 3] as any`,
  "an array-like object": `({ 0: 1, 1: 2, 2: 3, length: 3 }) as any`,
  "an arguments object": `(function (..._: number[]) { return arguments; })(1, 2, 3) as any`,
  "a string": `"abc" as any`,
  "a typed array": `new Uint8Array([1, 2, 3]) as any`,
  "a proxy for an array": `new Proxy([1, 2, 3], { get(target, key, receiver) { return key === "1" ? 20 : Reflect.get(target, key, receiver); } })`,
  "a function": `function (a: number, b: number) {} as any`,
  "a number": `5 as any`,
};

const programAboutReceivers = (names: string[]) =>
  typeScript(`function at(list: number[], index: number): unknown { return list[index]; }
function has(list: number[], index: number): boolean { return index in list; }
function put(list: number[], index: number, value: number): void { list[index] = value; }
function lengthOf(list: number[]): number { return list.length; }
function total(list: number[]): unknown {
  let sum = 0;
  for (let index = 0; index < list.length; index++) sum += list[index];
  return sum;
}
const receivers: [string, () => number[]][] = [
${names.map(name => `  [${JSON.stringify(name)}, () => ${receivers[name]}],`).join("\n")}
];
for (const [name, make] of receivers) {
  const read = make();
  for (const index of [0, 1, 2, 3, -1, 1.5]) attempt(name + ", read at " + index, () => at(read, index));
  attempt(name + ", has", () => nameOfError(() => [0, 1, 3].map(index => has(read, index)).join()));
  attempt(name + ", length", () => lengthOf(read));
  attempt(name + ", total", () => total(read));
  for (const index of [1, 3, 7, -1, 1.5]) {
    const stored = make();
    attempt(name + ", store at " + index, () => (put(stored, index, 9), [show(at(stored, index)), show(lengthOf(stored)), Object.keys(stored).slice(0, 8).join()].join(" ")));
  }
}
`);

const programs: Record<string, string> = {
  "every kind of key on an array":
    typeScript(`${keys}function at(list: number[], key: any): unknown { return list[key]; }
function has(list: number[], key: any): boolean { return key in list; }
function put(list: number[], key: any, value: number): void { list[key] = value; }
function remove(list: number[], key: any): boolean { return delete list[key]; }
function stateOf(list: number[]): string { return list.length + " " + Object.keys(list).join(); }
keys.forEach((key, position) => {
  const label = position + " " + show(key);
  const read = [10, 20, 30];
  attempt(label + ", read", () => at(read, key));
  attempt(label + ", has", () => has(read, key));
  const stored = [10, 20, 30];
  attempt(label + ", stored", () => (put(stored, key, 99), stateOf(stored) + " " + show(at(stored, key))));
  const removed = [10, 20, 30];
  attempt(label + ", removed", () => remove(removed, key) + " " + stateOf(removed));
});
function sum(list: number[], indexes: any[]): unknown {
  let total = 0;
  for (const index of indexes) total += list[index];
  return total;
}
function sumByKeys(list: number[]): number {
  let total = 0;
  for (const key in list) total += list[key as any];
  return total;
}
attempt("sum with number keys", () => sum([1, 2, 3], [0, 1, 2]));
attempt("sum with string keys", () => sum([1, 2, 3], ["0", "1", "2"]));
attempt("sum with number and string keys", () => sum([1, 2, 3], [0, "1", 2, "length"]));
attempt("sum past the end", () => sum([1, 2, 3], [0, 1, 2, 3]));
attempt("sum with for-in keys", () => sumByKeys([1, 2, 3]));
`),

  "every kind of key on typed arrays":
    typeScript(`${keys}function at(view: Uint8Array, key: any): unknown { return view[key]; }
function has(view: Uint8Array, key: any): boolean { return key in view; }
function put(view: Uint8Array, key: any, value: number): void { view[key] = value; }
function fractionAt(view: Float64Array, key: any): unknown { return view[key]; }
function putFraction(view: Float64Array, key: any, value: number): void { view[key] = value; }
function stateOf(view: Uint8Array | Float64Array): string { return Array.from(view).join() + " " + Object.keys(view).join(); }
const kinds: [string, () => Uint8Array][] = [
  ["Uint8Array", () => new Uint8Array([10, 20, 30])],
  ["Buffer", () => Buffer.from([10, 20, 30])],
  ["a Uint8Array subclass", () => new (class Bytes extends Uint8Array {})([10, 20, 30])],
  ["a view of part of a buffer", () => new Uint8Array(new Uint8Array([0, 10, 20, 30, 0]).buffer, 1, 3)],
];
for (const [kind, make] of kinds) {
  keys.forEach((key, position) => {
    const label = kind + ", " + position + " " + show(key);
    const read = make();
    attempt(label + ", read", () => at(read, key));
    attempt(label + ", has", () => has(read, key));
    const stored = make();
    attempt(label + ", stored", () => (put(stored, key, 99), stateOf(stored)));
  });
}
keys.forEach((key, position) => {
  const label = "Float64Array, " + position + " " + show(key);
  attempt(label + ", read", () => fractionAt(new Float64Array([1.5, 2.5, 3.5]), key));
  const stored = new Float64Array([1.5, 2.5, 3.5]);
  attempt(label + ", stored", () => (putFraction(stored, key, 9.5), stateOf(stored)));
});

const resizable = new (ArrayBuffer as any)(4, { maxByteLength: 8 });
const tracking = new Uint8Array(resizable);
tracking.set([1, 2, 3, 4]);
attempt("a length-tracking view", () => [at(tracking, 3), at(tracking, 1), tracking.length].join());
resizable.resize(2);
attempt("after the buffer shrank", () => [at(tracking, 3), at(tracking, 1), tracking.length].join());
attempt("a store past the new end", () => (put(tracking, 3, 9), stateOf(tracking)));
resizable.resize(6);
attempt("after the buffer grew", () => [at(tracking, 3), at(tracking, 5), tracking.length].join());
const transferred = new ArrayBuffer(2);
const left = new Uint8Array(transferred);
left.set([5, 6]);
attempt("before the buffer is detached", () => [at(left, 0), left.length].join());
(transferred as any).transfer();
attempt("after the buffer is detached", () => [at(left, 0), has(left, 0), left.length].join());
attempt("a store after the buffer is detached", () => (put(left, 0, 9), stateOf(left)));
`),

  // Plain Bun's and --aot's TypeError messages for an access on undefined or null both name the value.
  "undefined and null where an array is expected":
    typeScript(`function access(label: string, action: () => unknown): void {
  attempt(label, () => {
    try {
      return action();
    } catch (error) {
      const { name, message } = error as Error;
      return name + " about " + (message.includes("undefined") ? "undefined" : message.includes("null") ? "null" : "neither");
    }
  });
}
function first(list: number[], index: number): number { return list[index]; }
function firstOrNothing(list: number[] | undefined, index: number): number { return list![index]; }
function firstOrNull(list: number[] | null, index: number): number { return list![index]; }
function optional(list: number[] | null | undefined, index: number): number | undefined { return list?.[index]; }
function store(list: number[] | undefined, index: number, value: number): void { list![index] = value; }
function update(list: number[] | undefined, index: number): void { list![index]++; }
function byAnyKey(list: number[] | undefined, key: any): unknown { return list![key]; }
function hasKey(list: number[] | undefined, key: any): boolean { return key in list!; }
function byteAt(bytes: Uint8Array | undefined, index: number): number { return bytes![index]; }
function storeByte(bytes: Uint8Array | null, index: number, value: number): void { bytes![index] = value; }
function lengthOf(list: number[] | undefined): number { return list!.length; }
const list = [1, 2, 3];
const bytes = new Uint8Array([7, 8]);
for (let round = 0; round < 2; round++) {
  access("an array", () => first(list, 1));
  access("undefined typed as an array", () => first(undefined as any, 0));
  access("null typed as an array", () => first(null as any, 0));
  access("an array or undefined: an array", () => firstOrNothing(list, 2));
  access("an array or undefined: undefined", () => firstOrNothing(undefined, 0));
  access("an array or null: an array", () => firstOrNull(list, 0));
  access("an array or null: null", () => firstOrNull(null, 0));
  access("an optional chain", () => [optional(undefined, 0), optional(null, 0), optional(list, 0)].join());
  access("a store to undefined", () => store(undefined, 0, 1));
  access("a store to an array", () => (store(list, 0, 1), list.join()));
  access("an update of undefined", () => update(undefined, 0));
  access("an update of an array", () => (update(list, 2), list.join()));
  access("undefined with a string key", () => byAnyKey(undefined, "name"));
  access("undefined with a fractional key", () => byAnyKey(undefined, 1.5));
  access("undefined with a symbol key", () => byAnyKey(undefined, Symbol.iterator));
  access("an array with a string key", () => byAnyKey(list, "1"));
  attempt("in undefined", () => hasKey(undefined, 0));
  access("in an array", () => hasKey(list, 0));
  access("a byte of undefined", () => byteAt(undefined, 0));
  access("a byte", () => byteAt(bytes, 1));
  access("a store to null typed as bytes", () => storeByte(null, 0, 1));
  access("a store of a byte", () => (storeByte(bytes, 0, 9), bytes.join()));
  access("the length of undefined", () => lengthOf(undefined));
  access("the length of an array", () => lengthOf(list));
  access("undefined itself", () => (undefined as any)[0]);
  access("null itself", () => (null as any)[0]);
}

const order: string[] = [];
const convertible = { toString() { order.push("key converted"); return "0"; } };
function keyOf(): any { order.push("key evaluated"); return convertible; }
function valueToStore(): number { order.push("value evaluated"); return 5; }
function readIn(target: number[] | undefined): unknown { return target![keyOf()]; }
function storeIn(target: number[] | undefined): void { target![keyOf()] = valueToStore(); }
function addIn(target: number[] | undefined): void { target![keyOf()] += valueToStore(); }
const steps: [string, () => unknown][] = [
  ["a read of undefined", () => readIn(undefined)],
  ["a read of an array", () => readIn([7])],
  ["a store to undefined", () => storeIn(undefined)],
  ["a store to an array", () => storeIn([7])],
  ["an addition to undefined", () => addIn(undefined)],
  ["an addition to an array", () => addIn([7])],
];
for (const [label, step] of steps) {
  order.length = 0;
  attempt(label, step);
  console.log(label + ", order: " + order.join());
}
`),

  "a tuple has an array's members": typeScript(`type Pair = [number, string];
type Row = [number, ...string[]];
type Maybe = [number, string?];
function lengthOf(pair: Pair): number { return pair.length; }
function lengthOfRow(row: Row): number { return row.length; }
function lengthOfMaybe(maybe: Maybe): number { return maybe.length; }
function lengthOfFixed(fixed: readonly [number, number]): number { return fixed.length; }
function isLong(pair: Pair): boolean { return (pair.length as number) > 2; }
function joined(pair: Pair): string { return pair.map(String).join("+"); }
function last(pair: Pair): unknown { return pair.at(-1); }
function second(pair: Pair): unknown { return pair[1]; }
function at(pair: Pair, index: number): unknown { return pair[index]; }
function copy(pair: Pair): unknown[] { return [...pair]; }
function parts(pair: Pair): string { const [a, b] = pair; return a + "/" + b; }
function describe(label: string, pair: Pair): void {
  attempt(label + ", length", () => lengthOf(pair) + " " + isLong(pair));
  attempt(label + ", map", () => joined(pair));
  attempt(label + ", at", () => last(pair));
  attempt(label + ", elements", () => [show(second(pair)), show(at(pair, 0)), show(at(pair, 2))].join());
  attempt(label + ", spread", () => copy(pair));
  attempt(label + ", pattern", () => parts(pair));
  attempt(label + ", as an object", () => [Array.isArray(pair), pair instanceof Array, JSON.stringify(pair), Object.keys(pair).join()].join(" "));
}
const pair: Pair = [1, "one"];
describe("as created", pair);
(pair as any).push("more");
describe("after push", pair);
(pair as any).length = 1;
describe("after a shorter length", pair);
(pair as any)[4] = "far";
describe("after a store past the end", pair);
(pair as any).length = 0;
describe("emptied", pair);

const hidden: Pair = [2, "two"];
(hidden as any).map = function () { return ["own map"]; };
Object.defineProperty(hidden, "at", { value: () => "own at" });
describe("with its own map and at", hidden);

const reparented: Pair = [3, "three"];
Object.setPrototypeOf(reparented, Object.create(Array.prototype, { map: { value() { return ["map from the new prototype"]; } }, at: { value() { return "at from the new prototype"; } } }));
describe("with a different prototype", reparented);

const orphan: Pair = [4, "four"];
Object.setPrototypeOf(orphan, null);
attempt("with a null prototype, length", () => lengthOf(orphan));
attempt("with a null prototype, map", () => joined(orphan));
attempt("with a null prototype, elements", () => [show(second(orphan)), show(at(orphan, 0))].join());

class Pairs extends Array<number | string> {
  override map(): any { return ["map of the subclass"]; }
}
describe("an Array subclass instance", Pairs.from([5, "five"]) as unknown as Pair);
describe("frozen", Object.freeze([6, "six"]) as unknown as Pair);
describe("an array-like object", { 0: 7, 1: "seven", length: 2 } as unknown as Pair);

const row: Row = [1, "a", "b"];
attempt("a tuple with a rest element", () => lengthOfRow(row));
row.push("c");
attempt("a tuple with a rest element, after push", () => lengthOfRow(row));
const maybe: Maybe = [1];
attempt("a tuple with an optional element", () => lengthOfMaybe(maybe));
maybe[1] = "there";
attempt("a tuple with an optional element, filled", () => lengthOfMaybe(maybe));
const fixed = [1, 2] as const;
attempt("a read-only tuple", () => lengthOfFixed(fixed));
(fixed as any).push(3);
attempt("a read-only tuple, after push", () => lengthOfFixed(fixed));
`),

  "members that Buffer overrides": typeScript(`function cut(bytes: Uint8Array): Uint8Array { return bytes.slice(0, 2); }
function cutBuffer(buffer: Buffer): Uint8Array { return buffer.slice(0, 2); }
function text(bytes: Uint8Array): string { return bytes.toString(); }
function textOfBuffer(buffer: Buffer): string { return buffer.toString(); }
function find(bytes: Uint8Array, value: number): number { return bytes.indexOf(value); }
function holds(bytes: Uint8Array, value: number): boolean { return bytes.includes(value); }
function serialized(bytes: Uint8Array): string { return JSON.stringify(bytes); }
function sharesMemory(whole: Uint8Array, part: Uint8Array): boolean {
  part[0] = 1;
  return whole[0] === 1;
}
const kinds: [string, () => Uint8Array][] = [
  ["Uint8Array", () => new Uint8Array([97, 98, 99])],
  ["Buffer.from", () => Buffer.from("abc")],
  ["Buffer.alloc", () => Buffer.alloc(3, 97)],
  ["part of a Buffer", () => Buffer.from("zabc").subarray(1)],
  ["a Uint8Array subclass", () => new (class Bytes extends Uint8Array {})([97, 98, 99])],
  ["a Uint8Array with Buffer.prototype", () => Object.setPrototypeOf(new Uint8Array([97, 98, 99]), Buffer.prototype)],
  ["a Buffer with Uint8Array.prototype", () => Object.setPrototypeOf(Buffer.from("abc"), Uint8Array.prototype)],
];
function describe(): void {
  for (const [kind, make] of kinds) {
    attempt(kind + ", text", () => text(make()) + " " + textOfBuffer(make() as Buffer));
    attempt(kind + ", slice", () => { const whole = make(); return cut(whole).constructor.name + " " + sharesMemory(whole, cut(whole)); });
    attempt(kind + ", slice as a Buffer", () => { const whole = make() as Buffer; return cutBuffer(whole).constructor.name + " " + sharesMemory(whole, cutBuffer(whole)); });
    attempt(kind + ", search", () => find(make(), 98) + " " + holds(make(), 99) + " " + holds(make(), 1));
    attempt(kind + ", JSON", () => serialized(make()));
  }
}
describe();
describe();
`),

  "every receiver at one site": programAboutReceivers(Object.keys(receivers)),
};

const ways: Record<string, string[]> = {
  "by default": [],
  "in a validating build": [buildFlags.validate],
  "without flow results": [buildFlags.withoutFlowResults],
  "with types erased": [buildFlags.eraseTypes],
};
// A debug or ASAN build of Bun is many times slower.
const chosen = (names: string[]) => (wanted === "quick" ? names.slice(0, 1) : names);

// `undefined[key] = value` throws before the key is made a property key: so the language has it since 2020, and so does the executable.
// Bun: `bun run` converts the key first, which runs its toString(), and throws then.
const whereTheLanguageIsTheOracle: [string, string][] = [
  [
    "a store to undefined, order: key evaluated,value evaluated,key converted\n",
    "a store to undefined, order: key evaluated,value evaluated\n",
  ],
];

async function expectOutputOfPlainBun(text: string, flags: string[]) {
  using dir = tempDir("aot-array-element-keys", { "tsconfig.json": tsconfig, "main.ts": text });
  const folder = String(dir);
  const plain = await spawned([bunExe(), "run", "main.ts"], folder, bunEnv);
  expect({
    signal: plain.signal,
    exitCode: plain.exitCode,
    stderr: plain.stderr,
    printsNothing: plain.stdout === "",
  }).toEqual({ signal: null, exitCode: 0, stderr: "", printsNothing: false });
  const executable = join(folder, "program" + (isWindows ? ".exe" : ""));
  built(await spawned([bunExe(), ...compileCommand, ...flags, "main.ts", "--outfile", executable], folder, bunEnv));
  const compiled = await spawned(withoutCoreDump([executable]), folder, {
    ...bunEnv,
    [runtimeEnvironment.forbidsInterpreter]: "1",
  });
  for (const [printedByBunRun, right] of whereTheLanguageIsTheOracle)
    plain.stdout = plain.stdout.replace(printedByBunRun, right);
  expect({ signal: compiled.signal, ...told(compiled) }).toEqual({ signal: null, ...told(plain) });
}

describe.concurrent("compile/aot/array element keys", () => {
  for (const [name, text] of Object.entries(programs)) {
    for (const way of chosen(Object.keys(ways))) {
      test(`${name}, ${way}`, () => slot(() => expectOutputOfPlainBun(text, ways[way])), 600_000);
    }
  }
});

// The analysis proves more about a program that has only one kind of receiver.
describe.concurrent("compile/aot/array element keys/one receiver per program", () => {
  for (const name of Object.keys(receivers)) {
    for (const way of chosen(["by default", "in a validating build"])) {
      test(
        `${name}, ${way}`,
        () => slot(() => expectOutputOfPlainBun(programAboutReceivers([name]), ways[way])),
        600_000,
      );
    }
  }
});
