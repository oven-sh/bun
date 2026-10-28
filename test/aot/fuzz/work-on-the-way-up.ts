// Recursion of every kind down to the end of the stack, caught at every depth on the way up, and real work in each catch and finally: with a little more room each time, so that every call inside the work meets the end of the stack once.
//
//   roads     a call, two functions, a closure, getters, setters, proxies (get, has, apply, construct), bound functions, call, apply, Reflect.apply, callbacks of array methods, toString, valueOf, Symbol.toPrimitive, Symbol.hasInstance,
//             revivers of JSON.parse, toJSON, replacers of regular expressions, generators, iterators in a spread, async functions, executors of promises, constructors, super calls, private methods, tagged templates, default values of parameters,
//             text that becomes code at run time
//   caught    and thrown on; in a finally; thrown anew, with and without a cause; swallowed at some depths; in a finally inside a catch; swallowed, and down again from there
//   work      node:util (promisify, inspect, format, isDeepStrictEqual), node:assert that holds and that fails, node:events, node:path, Buffer, Error.captureStackTrace and .stack, structuredClone, URL, TextEncoder, promises, async functions,
//             microtasks, ticks, timers, JSON, sort, replace, allocation of every kind, errors of every kind thrown and caught, functions of the program that are called for the first time there;
//             and, in every program, built-ins that call back into the program or make its objects: comparers, callbacks of arrays and typed arrays, replacers, revivers, toJSON, accessors read by built-ins, Reflect.construct, species,
//             subclasses of built-ins, iterators, traps of proxies, toString and valueOf, thenables, prepareStackTrace, listeners;
//             and functions with a rest parameter, `arguments` or default values, async or generators, called as values: from a function of one line, from one that reads its own values behind the call, right in the catch
//   stairs    each piece of work is entered through 0 to 23 more frames of two sizes
//   frames    of the recursing function: 0 to 12 more variables
//
// How deep the stack is differs between a compiled program and plain Bun, so nothing that is printed depends on it: work that runs through must answer what it answered at the top, work that fails must fail with a RangeError,
// and behind the unwinding everything must work as before.
import type { Random } from "./random";

export const prelude = `declare function require(name: string): any;
declare const process: any;
declare const Buffer: any;
const util = require("node:util");
const assert = require("node:assert");
const { EventEmitter } = require("node:events");
const path = require("node:path");
const budget = 6000000;
// An assertion that fails sets the limit to 0 while it words its message. Where the end of the stack cuts that short, plain Bun leaves it at 0 too.
const framesInATrace: number = (Error as any).stackTraceLimit;
const strange = new Set<string>();
const wrong = new Set<string>();
function nothing() {}
process.on("unhandledRejection", nothing);
function note(where: string, error: unknown): void {
  if (!(error instanceof RangeError)) strange.add(where + " " + (error instanceof Error ? error.name : typeof error));
}
let climbed = 0;
function climb(steps: number, run: () => unknown): unknown {
  const result = steps > 0 ? climb(steps - 1, run) : run();
  // Something is left to do behind the call, so each step has a frame.
  climbed++;
  return result;
}
function climbWide(steps: number, run: () => unknown): unknown {
  const p = steps + 0.5, q = steps * 1.5, r = steps / 3, s = "s" + steps, t = [steps];
  const result = steps > 0 ? climbWide(steps - 1, run) : run();
  return p + q + r === -1 ? s + t.length : result;
}
class Failure extends Error {
  constructor(public code: number) {
    super("failure " + code);
    this.name = "Failure";
  }
}
class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
  get sum(): number {
    return this.x + this.y;
  }
}
function* upTo(n: number): Generator<number, void, unknown> {
  for (let i = 0; i < n; i++) yield i;
}
async function soon(x: number): Promise<number> {
  await null;
  return x + 1;
}
const emitter = new EventEmitter();
let heard = 0;
emitter.on("ping", (n: number) => {
  heard += n;
});
// Functions that the compiler cannot follow to their calls.
(globalThis as any).calledAsValues = {
  asyncRest: async function (...rest: unknown[]) { return rest.length; },
  asyncArguments: async function () { return arguments.length; },
  asyncDefaults: async function (a = 1, b = [a]) { return b.length; },
  asyncGeneratorRest: async function* (...rest: unknown[]) { yield rest.length; },
  generatorRest: function* (...rest: unknown[]) { yield rest.length; },
  generatorArguments: function* () { yield arguments.length; },
  rest: function (...rest: unknown[]) { return rest.length; },
  readsArguments: function () { return arguments.length; },
};
const seen: Record<string, (...given: unknown[]) => any> = (globalThis as any)[Object.keys(globalThis).find(key => key === "calledAsValues")!];
function readsItsOwn(a: number, b: string): number {
  const local = [a, a + 1];
  seen.asyncRest(a, b);
  return a + b.length + local[1];
}
`;

// Each answers with a string or a number that does not depend on when it runs. Where the library itself catches the end of the stack and answers with less, only the kind of the answer counts.
export const probes: readonly (readonly [name: string, body: string])[] = [
  ["promisify", `return typeof util.promisify(nothing)().then(nothing, nothing);`],
  ["promisify-with-a-result", `return typeof util.promisify((done: (error: null, value: number) => void) => done(null, 1))().then(nothing);`],
  ["inspect", `return typeof util.inspect({ a: [1, { b: new Map([[1, new Set([2])]]) }], c: "d" });`],
  ["format", `return typeof util.format("%s %d %j %o", "a", 1.5, { b: [2] }, [3]);`],
  ["deep-equal", `return String(util.isDeepStrictEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] }));`],
  ["assert-holds", `assert.strictEqual(1, 1); assert.deepStrictEqual({ a: [1, 2] }, { a: [1, 2] }); assert.ok(true); return 1;`],
  ["assert-fails", `try { assert.strictEqual(1, 2); } catch (error) { if (error instanceof RangeError) throw error; return (error as Error).name; } return "held";`],
  ["assert-deep-fails", `try { assert.deepStrictEqual({ a: [1, 2] }, { a: [1, 3] }); } catch (error) { if (error instanceof RangeError) throw error; return (error as Error).name; } return "held";`],
  ["assert-throws", `assert.throws(() => { throw new TypeError("t"); }, TypeError); return 1;`],
  ["events", `const before = heard; emitter.emit("ping", 2); return heard - before;`],
  ["path", `return path.join("a", "..", "b", "c.txt") + path.extname("x.y.z") + path.basename("/p/q");`],
  ["buffer", `return Buffer.from("where the stack ends").toString("base64") + Buffer.concat([Buffer.from("a"), Buffer.alloc(2, 98)]).toString("hex");`],
  ["buffer-numbers", `const bytes = Buffer.alloc(16); bytes.writeUInt32LE(4022250974, 0); bytes.writeDoubleBE(0.5, 8); return bytes.readUInt32LE(0) + bytes.readDoubleBE(8);`],
  ["capture-stack-trace", `(Error as any).stackTraceLimit = framesInATrace; const holder: { stack?: string } = {}; (Error as any).captureStackTrace(holder); return typeof holder.stack;`],
  ["stack", `(Error as any).stackTraceLimit = framesInATrace; return typeof new Error("e").stack;`],
  ["structured-clone", `const copy = structuredClone({ a: [1, new Map([[2, new Date(3)]])], b: new Uint8Array([4, 5]) }); return copy.a.length * 10 + copy.b[1];`],
  ["url", `const url = new URL("http://host:81/a/b?c=d&e=f#g"); return url.searchParams.get("e") + url.port + url.hash;`],
  ["text-encoder", `return new TextDecoder().decode(new TextEncoder().encode("h\\u00e9llo")).length;`],
  ["promises", `void Promise.all([Promise.resolve(1), soon(2), new Promise(resolve => resolve(3))]).then(nothing, nothing); void Promise.reject(new Failure(1)).catch(nothing).finally(nothing); return 1;`],
  ["async-function", `return typeof soon(1).then(value => value + 1);`],
  ["microtask-tick-timer", `queueMicrotask(nothing); process.nextTick(nothing); clearTimeout(setTimeout(nothing, 0)); return 1;`],
  ["json", `return JSON.stringify(JSON.parse('{"a":[1,2,{"b":null}],"c":"d"}', (_key, value) => (typeof value === "number" ? value + 1 : value)), null, 1).length;`],
  ["sort-map-reduce", `return [5, 3, 9, 1].sort((a, b) => a - b).map(each => each * 2).filter(each => each > 2).reduce((a, b) => a + b, 0);`],
  ["replace", `return "a1b22c333".replace(/\\d+/g, digits => "<" + digits.length + ">") + "x-y".split("-").join("+");`],
  ["objects", `const made = { a: new Point(1, 2), b: [new Point(3, 4)], c: { d: { e: 5 } } }; return made.a.sum + made.b[0].sum + made.c.d.e;`],
  ["collections", `const map = new Map<unknown, number>([["k", 1], [2, 3]]); const set = new Set([1, 2, 2]); const weak = new WeakMap([[map, set]]); return map.size + set.size + weak.get(map)!.size;`],
  ["typed-arrays", `const floats = new Float64Array([1.5, 2.5]); const view = new DataView(floats.buffer); return floats[0] + view.getFloat64(8, true) + new Uint16Array(3).fill(7)[2];`],
  ["strings", `return ("ab".repeat(3) + "c".padStart(4, "-") + String(12.5) + (255).toString(16) + \`\${1 + 1}\`).toUpperCase();`],
  ["closures-generators", `const add = (a: number) => (b: number) => a + b; return add(1)(2) + [...upTo(4)].length + Array.from({ length: 3 }, (_, at) => at).length;`],
  ["bigint-symbol-date-regexp", `return String(2n ** 70n) + Symbol("s").toString() + new Date(86400000).toISOString() + /(a)(b)?/.exec("ab")!.length;`],
  ["errors-of-every-kind", `let names = ""; for (const run of [() => (null as any).x, () => (undefined as any)(), () => new Array(-1), () => { throw new Failure(2); }, () => decodeURIComponent("%"), () => JSON.parse("{")]) try { run(); } catch (error) { if (error instanceof RangeError && (error as Error).message.includes("stack")) throw error; names += (error as Error).name; } return names;`],
  ["spread-destructure", `const [first, ...rest] = [1, 2, 3]; const { a, ...others } = { a: 1, b: 2, c: 3 }; return Math.max(...rest, first) + a + Object.keys(others).length;`],
  ["class-made-there", `class Local extends Point { #hidden = 3; static count = 0; get all(): number { return this.sum + this.#hidden + ++Local.count; } } return new Local(1, 2).all;`],
  ["text-made-there", `return new Function("a", "b", "return a * b + 1")(6, 7);`],
];

// Built-ins that call back into the program, or make an object of the program's, and go on with what comes back.
export const callbacks: readonly (readonly [name: string, body: string])[] = [
  ["sort-comparer", `return [3, 1, 2, 5, 4].sort((a, b) => b - a).join("") + [2, 1].toSorted((a, b) => a - b).join("");`],
  ["map-for-each-reduce", `let seen = 0; [1, 2, 3].forEach(each => { seen += each; }); return seen + [1, 2].map(each => each * 2).reduce((a, b) => a + b, 0) + [4, 5].reduceRight((a, b) => a - b);`],
  ["some-every-find", `return String([1, 2].some(each => each > 1)) + [1, 2].every(each => each > 1) + [1, 2, 3].find(each => each > 1) + [1, 2, 3].findLast(each => each < 3) + [1, 2].findIndex(each => each === 2);`],
  ["flat-map-filter", `return [1, 2].flatMap(each => [each, [each]]).length + [1, 2, 3].filter(each => each & 1).length;`],
  ["array-from", `return Array.from([1, 2, 3], each => each * 2).join() + Array.from(upTo(3), each => each + 1).join() + Array.from({ length: 2, 0: "a", 1: "b" }).join();`],
  ["replace-function", `return "abcabc".replace(/b/g, found => found.toUpperCase()) + "xyx".replaceAll("x", () => "-") + "a1".replace(/(\\d)/, (_all, digit) => digit + digit);`],
  ["to-json", `return JSON.stringify({ a: { toJSON: () => [1, { toJSON: () => "in" }] }, b: new Date(0) });`],
  ["stringify-replacer", `return JSON.stringify({ a: 1, b: [2, 3], c: { d: 4 } }, (_key, value) => (typeof value === "number" ? value * 2 : value));`],
  ["parse-reviver", `return JSON.stringify(JSON.parse('{"a":[1,{"b":2}],"c":3}', function (this: unknown, key, value) { return key === "b" ? [value] : value; }));`],
  ["define-properties", `const made: any = Object.defineProperties({}, { a: { get: () => 1, enumerable: true }, b: { get() { return (this as any).a + 1; }, enumerable: true } }); return made.a + made.b + Object.values(made).length + JSON.stringify(made);`],
  ["assign-through-accessors", `let stored = 0; const target = { set a(value: number) { stored = value; } }; Object.assign(target, { get a() { return 7; } }); return stored + Object.entries({ get b() { return 2; } })[0][1];`],
  ["reflect-construct", `class Other {} const made = Reflect.construct(Point, [1, 2], Other); return String(made instanceof Other) + Reflect.construct(Point, [3, 4]).sum + Reflect.construct(Array, [3]).length + Reflect.apply(Math.max, null, [1, 5]);`],
  ["typed-array-callbacks", `return Uint8Array.from([1, 2, 3], each => each * 2).join() + new Int16Array([3, 1, 2]).sort((a, b) => b - a).join() + new Float32Array([1, 2]).map(each => each / 2).join() + new Uint8Array([1, 2, 3]).filter(each => each > 1).length + new Uint8Array([4, 5]).reduce((a, b) => a + b, 0);`],
  ["subarray-slice-encode-into", `const bytes = new Uint8Array(8); const told = new TextEncoder().encodeInto("h\\u00e9llo", bytes.subarray(-4)); return told.read * 10 + told.written + bytes.slice(4).join() + bytes.subarray(1, 3).length;`],
  ["species", `class Mine<T> extends Array<T> {} const mine = Mine.from([1, 2, 3]); return String(mine.map(each => each) instanceof Mine) + mine.filter(() => true).length + mine.slice(1).length + mine.concat([4]).length + (mine.flat() instanceof Mine);`],
  ["subclasses-of-built-ins", `class Table extends Map<number, number> { total(): number { let sum = 0; for (const value of this.values()) sum += value; return sum; } } class Later<T> extends Promise<T> {} class Bytes extends Uint8Array {} void Later.resolve(1).then(nothing); return new Table([[1, 2], [3, 4]]).total() + new Bytes(3).length + String(new Bytes(2).map(each => each) instanceof Bytes);`],
  ["iterators-for-built-ins", `const twice = { *[Symbol.iterator]() { yield [1, 2] as [number, number]; yield [3, 4] as [number, number]; } }; return new Map(twice).size + new Set(upTo(3)).size + Object.fromEntries(twice)[3] + Math.max(...upTo(4)) + Promise.all.length + [...new Map(twice).keys()].join();`],
  ["proxy-traps-from-built-ins", `let traps = 0; const proxy = new Proxy({ a: 1, b: 2 } as Record<string, number>, { ownKeys: target => (traps++, Reflect.ownKeys(target)), getOwnPropertyDescriptor: (target, key) => (traps++, Reflect.getOwnPropertyDescriptor(target, key)), get: (target, key, self) => (traps++, Reflect.get(target, key, self)) }); return Object.keys(proxy).length + JSON.stringify(proxy) + Object.entries({ ...proxy }).length + (traps > 0);`],
  ["to-string-from-built-ins", `const named = { toString: () => "n" }; const counted = { valueOf: () => 4 }; return [named, named].join("+") + String(named) + "x".repeat(counted as any) + "abc".indexOf(named as any) + [1, 2, 3, 4, 5].at(counted as any) + new Array(counted as any).length + parseInt({ toString: () => "12" } as any);`],
  ["concat-spreadable", `const like = { length: 2, 0: "a", 1: "b", get [Symbol.isConcatSpreadable]() { return true; } }; return ([0] as unknown[]).concat(like, [[1]]).length;`],
  ["group-by", `return Object.keys(Object.groupBy([1, 2, 3, 4], each => (each & 1 ? "odd" : "even"))).join() + Map.groupBy([1, 2, 3], each => each % 2).size;`],
  ["thenables", `void Promise.resolve({ then(resolve: (value: number) => void) { resolve(1); } }).then(nothing); void Promise.race([{ then(_resolve: unknown, reject: (error: Error) => void) { reject(new Failure(3)); } }]).catch(nothing); void Promise.allSettled([soon(1), Promise.reject(new Failure(4))]).then(nothing); return 1;`],
  ["bound-and-called-by-built-ins", `const add = function (this: Point, more: number) { return this.sum + more; }.bind(new Point(1, 2)); return [1, 2].map(add).join() + Reflect.apply(add, null, [3]) + add.call(null, 4) + [5].map(Number.prototype.toFixed.call.bind(Number.prototype.toFixed)).length;`],
  ["prepare-stack-trace", `(Error as any).stackTraceLimit = framesInATrace; const kept = (Error as any).prepareStackTrace; (Error as any).prepareStackTrace = (_error: Error, sites: unknown[]) => typeof sites.length; try { return new Error("p").stack; } finally { (Error as any).prepareStackTrace = kept; }`],
  ["getters-seen-by-clone-and-inspect", `let reads = 0; const watched = { get a() { reads++; return [1]; } }; structuredClone(watched); util.inspect(watched, { getters: true }); util.isDeepStrictEqual(watched, { a: [1] }); return reads > 0;`],
  ["buffer-from-things", `return Buffer.from({ length: 2, 0: 65, 1: 66 }).toString() + Buffer.from(new String("cd")).toString() + Buffer.from([{ valueOf: () => 69 } as any]).toString() + Buffer.from("6667", "hex").map((each: number) => each + 1).toString();`],
  ["emit-to-many", `const local = new EventEmitter(); let sum = 0; local.once("e", (n: number) => { sum += n; }); local.on("e", (n: number) => { sum += n * 2; }); local.prependListener("e", () => { sum += 100; }); local.emit("e", 1); local.emit("e", 1); return sum + local.listenerCount("e");`],
  ["weak-refs-and-registries", `const target = new Point(1, 2); const registry = new FinalizationRegistry(nothing); registry.register(target, 1); return new WeakRef(target).deref()!.sum + new WeakSet([target]).has(target as any as Point).toString();`],
];

// A call that returns as usual though the callee found no room: functions with a rest parameter, `arguments` or default values, called as values, from a function of one line.
const asValues: readonly (readonly [name: string, body: string])[] = [
  ["async-rest-as-a-value", `seen.asyncRest(1, 2, 3); return 1;`],
  ["async-rest-as-a-value-and-then", `void seen.asyncRest(1, 2, 3).then(nothing, nothing); return 1;`],
  ["async-arguments-as-a-value", `seen.asyncArguments(1, 2); return 1;`],
  ["async-defaults-as-a-value", `seen.asyncDefaults(); return 1;`],
  ["async-generator-rest-as-a-value", `seen.asyncGeneratorRest(1, 2).next(); return 1;`],
  ["generator-rest-as-a-value", `return seen.generatorRest(1, 2).next().value;`],
  ["generator-arguments-as-a-value", `return seen.generatorArguments(1, 2, 3).next().value;`],
  ["rest-as-a-value", `return seen.rest(1, 2, 3);`],
  ["arguments-as-a-value", `return seen.readsArguments(1, 2);`],
  ["a-caller-that-reads-its-own-values", `return readsItsOwn(3, "four");`],
  ["assert-rejects", `assert.rejects(nothing); return 1;`],
  ["assert-rejects-handed-on", `return typeof assert.rejects(nothing);`],
  ["assert-does-not-reject", `assert.doesNotReject(nothing); return 1;`],
  ["timers-promises", `void require("node:timers/promises").setImmediate(1).then(nothing, nothing); return 1;`],
];

type Road = readonly [name: string, call: (down: string, id: number) => string, beside?: (down: string, id: number) => string];
const roads: readonly Road[] = [
  ["a-call", down => `${down}(level + 1)`],
  ["two-functions", (_, id) => `other${id}(level + 1)`, (down, id) => `function other${id}(level: number): number {\n  const kept = [level, level];\n  return ${down}(level) + kept[0] - kept[1];\n}`],
  ["a-closure", down => `(() => ${down}(level + 1))()`],
  ["a-getter", (_, id) => `((getter${id}.level = level + 1), getter${id}.next)`, (down, id) => `const getter${id} = {\n  level: 0,\n  get next(): number {\n    return ${down}(this.level);\n  },\n};`],
  ["a-setter", (_, id) => `((setter${id}.value = level + 1), setter${id}.result)`, (down, id) => `const setter${id} = {\n  result: 0,\n  set value(level: number) {\n    this.result = ${down}(level);\n  },\n};`],
  ["a-proxy-get", (_, id) => `proxy${id}[level + 1]`, (down, id) => `const proxy${id}: Record<number, number> = new Proxy({}, { get: (_target, key) => ${down}(Number(key as string)) });`],
  ["a-proxy-has", (_, id) => `(String(level + 1) in proxy${id} ? 0 : 0)`, (down, id) => `const proxy${id} = new Proxy({}, { has: (_target, key) => ${down}(Number(key as string)) >= 0 });`],
  ["a-proxy-apply", (_, id) => `proxy${id}(level + 1)`, (down, id) => `const proxy${id}: (level: number) => number = new Proxy(nothing as any, { apply: (_target, _self, given) => ${down}(given[0]) });`],
  ["a-proxy-construct", (_, id) => `new proxy${id}(level + 1).result`, (down, id) => `const proxy${id}: new (level: number) => { result: number } = new Proxy(class {} as any, { construct: (_target, given) => ({ result: ${down}(given[0]) }) });`],
  ["a-bound-function", (_, id) => `bound${id}(level + 1)`, (down, id) => `const bound${id} = ${down}.bind(null);`],
  ["call", down => `${down}.call(null, level + 1)`],
  ["apply", down => `${down}.apply(null, [level + 1])`],
  ["reflect-apply", down => `Reflect.apply(${down}, undefined, [level + 1])`],
  ["map", down => `[level + 1].map(each => ${down}(each))[0]`],
  ["for-each", down => `(() => { let result = 0; [level + 1].forEach(each => { result = ${down}(each); }); return result; })()`],
  ["reduce", down => `[level + 1].reduce((sum, each) => sum + ${down}(each), 0)`],
  ["find", down => `([level + 1].find(each => ${down}(each) < 0) ?? 0)`],
  ["sort", down => `([2, 1].sort((a, b) => ${down}(level + 1) + a - b)[0] - 1)`],
  ["array-from", down => `Array.from({ length: 1 }, () => ${down}(level + 1))[0]`],
  ["to-string", down => `Number("" + { toString: () => String(${down}(level + 1)) })`],
  ["value-of", down => `+({ valueOf: () => ${down}(level + 1) } as any)`],
  ["to-primitive", down => `+({ [Symbol.toPrimitive]: () => ${down}(level + 1) } as any)`],
  ["has-instance", (_, id) => `(((level + 1) as any) instanceof Tester${id} ? 0 : 0)`, (down, id) => `class Tester${id} {\n  static [Symbol.hasInstance](level: number): boolean {\n    return ${down}(level) >= 0;\n  }\n}`],
  ["a-reviver", down => `JSON.parse("[1]", (key, value) => (key === "0" ? ${down}(level + 1) : value))[0]`],
  ["to-json", down => `Number(JSON.stringify({ toJSON: () => ${down}(level + 1) }))`],
  ["a-replacer", down => `Number("a".replace(/a/, () => String(${down}(level + 1))))`],
  ["a-generator", (_, id) => `(generator${id}(level + 1).next().value as number)`, (down, id) => `function* generator${id}(level: number): Generator<number, void, unknown> {\n  yield ${down}(level);\n}`],
  ["a-spread", (_, id) => `[...generator${id}(level + 1)][0]`, (down, id) => `function* generator${id}(level: number): Generator<number, void, unknown> {\n  yield ${down}(level);\n}`],
  ["an-async-function", (_, id) => `(async${id}(level + 1).catch(nothing), 0)`, (down, id) => `async function async${id}(level: number): Promise<number> {\n  return ${down}(level);\n}`],
  ["an-executor", down => `(new Promise<number>(resolve => resolve(${down}(level + 1))).catch(nothing), 0)`],
  ["a-constructor", (_, id) => `new Maker${id}(level + 1).result`, (down, id) => `class Maker${id} {\n  result: number;\n  constructor(level: number) {\n    this.result = ${down}(level);\n  }\n}`],
  ["a-super-call", (_, id) => `new Child${id}(level + 1).result`, (down, id) => `class Parent${id} {\n  result: number;\n  constructor(level: number) {\n    this.result = ${down}(level);\n  }\n}\nclass Child${id} extends Parent${id} {\n  constructor(level: number) {\n    super(level);\n  }\n}`],
  ["a-private-method", (_, id) => `walker${id}.step(level + 1)`, (down, id) => `class Walker${id} {\n  #step(level: number): number {\n    return ${down}(level);\n  }\n  step(level: number): number {\n    return this.#step(level);\n  }\n}\nconst walker${id} = new Walker${id}();`],
  ["a-tagged-template", (_, id) => `tag${id}\`\${level + 1}\``, (down, id) => `function tag${id}(_texts: TemplateStringsArray, level: number): number {\n  return ${down}(level);\n}`],
  ["a-default-value", (_, id) => `given${id}(level + 1)`, (down, id) => `function given${id}(level: number, result: number = ${down}(level)): number {\n  return result;\n}`],
  ["text-at-run-time", (_, id) => `text${id}(level + 1)`, (down, id) => `const text${id}: (level: number) => number = new Function("down", "return function (level) { return down(level); }")(${down});`],
];

export function generate(random: Random): string {
  const pick = <T>(items: readonly T[]) => random.pick(items);
  const text: string[] = [prelude];
  const used = [...random.sample(asValues, random.between(0, 3)), ...random.sample(callbacks, random.between(1, 4)), ...random.sample(probes, random.between(1, 3))];
  used.forEach(([, body], at) => text.push(`function probe${at}(): unknown {\n  ${body}\n}`));
  // At the top first: what the library sets up at its first use is set up, and the answers are known.
  text.push(`const expected = [${used.map((_, at) => `probe${at}()`).join(", ")}];`);
  const names: string[] = [];
  const cases = random.between(1, 3);
  for (let id = 1; id <= cases; id++) {
    const [roadName, call, beside] = pick(roads);
    const down = `down${id}`;
    const mine = random.sample(used.map((_, at) => at), random.between(1, 3));
    // One level of the recursion may take hundreds of bytes. The steps divide them, so that a call that fails only where a few bytes are missing comes there.
    const steps = pick([1, 3, 6, 13, 24, 24]);
    // Some work takes a thousand times as long as other work.
    const price = mine.reduce((sum, at) => sum + (/assert-.*fails|inspect|format|structured-clone|promises|thenables|subclasses|prepare-stack|capture-stack/.test(used[at][0]) ? 12 : 1), 0) * steps;
    const most = Math.max(20, Math.min(pick([40, 300, 300, 2000]), Math.floor(4000 / price)));
    const every = pick([1, 1, 1, 3, 17]);
    const firsts = pick([0, 0, 8, 24]);
    const variables = pick([0, 0, 1, 4, 12]);
    const climbs = pick(["climb", "climb", "climbWide"]);
    const direct = pick(["", "", "", "asyncRest(level, level)", "asyncArguments(level)", "asyncDefaults()", "asyncGeneratorRest(level).next()"]);
    const work = `${direct ? `if (direct${id}++ < 3000) seen.${direct};\n    ` : ""}work${id}(level)`;
    const road = call(down, id);
    const [caughtName, caught] = pick<readonly [string, string]>([
      ["thrown-on", `try {\n    below = ${road};\n  } catch (error) {\n    ${work};\n    throw error;\n  }`],
      ["thrown-on", `try {\n    below = ${road};\n  } catch (error) {\n    ${work};\n    throw error;\n  }`],
      ["in-a-finally", `try {\n    below = ${road};\n  } finally {\n    ${work};\n  }`],
      ["thrown-anew", `try {\n    below = ${road};\n  } catch {\n    ${work};\n    throw new RangeError("anew");\n  }`],
      ["thrown-anew-with-a-cause", `try {\n    below = ${road};\n  } catch (error) {\n    ${work};\n    throw level % 50 ? error : new RangeError("anew", { cause: error });\n  }`],
      ["swallowed-at-some-depths", `try {\n    below = ${road};\n  } catch (error) {\n    ${work};\n    if (level % 64) throw error;\n    below = 0;\n  }`],
      ["a-finally-inside-a-catch", `try {\n    try {\n      below = ${road};\n    } finally {\n      ${work};\n    }\n  } catch (error) {\n    ${work};\n    throw error;\n  }`],
      ["down-again", `try {\n    below = ${road};\n  } catch (error) {\n    ${work};\n    if (again${id}++ >= 40) throw error;\n    below = ${road};\n  }`],
    ]);
    names.push(`${roadName}--${caughtName}--${mine.map(at => used[at][0]).join("+")}--${steps}-steps--${variables}-variables${firsts ? `--${firsts}-first-calls` : ""}${direct ? "--" + direct.replace(/\(.*/, "") + "-right-there" : ""}`);
    text.push(`// ${id}: ${names[names.length - 1]}`);
    for (let first = 0; first < firsts; first++) text.push(`function first${id}_${first}(x: number): number {\n  const made = ${pick([`[x, ${first}]`, `{ a: x, b: ${first} }`, `new Point(x, ${first})`, `"f" + x + ${first}`])};\n  return made === null ? -1 : x * 3 + ${first};\n}`);
    if (firsts) text.push(`const firsts${id} = [${Array.from({ length: firsts }, (_, first) => `first${id}_${first}`).join(", ")}];`);
    text.push(`let calls${id} = 0;\nlet worked${id} = 0;\nlet again${id} = 0;\nlet direct${id} = 0;
function work${id}(level: number): void {
  if (worked${id} >= ${most} || level % ${every}) return;
  worked${id}++;
${mine.map(at => `  for (let step = 0; step < ${steps}; step++)\n    try {\n      if (${climbs}(step, probe${at}) !== expected[${at}]) wrong.add("${id} ${used[at][0]}");\n    } catch (error) {\n      note("${id} ${used[at][0]}", error);\n    }`).join("\n")}${
      firsts
        ? `\n  if (worked${id} <= ${firsts})\n    try {\n      if (firsts${id}[worked${id} - 1](level) !== level * 3 + worked${id} - 1) wrong.add("${id} a first call");\n    } catch (error) {\n      worked${id}--;\n      note("${id} a first call", error);\n    }`
        : ""
    }
}`);
    text.push(`function ${down}(level: number): number {
  if (++calls${id} >= budget) return 0;
  ${Array.from({ length: variables }, (_, at) => `const v${at} = ${pick([`level + ${at}.5`, `"v" + level`, `[level, ${at}]`, `level * ${at + 2}`, `{ level }`])};`).join("\n  ")}
  let below = 0;
  ${caught}
  return below${Array.from({ length: variables }, (_, at) => ` + (v${at} === undefined ? 1 : 0)`).join("")};
}`);
    if (beside) text.push(beside(down, id));
    text.push(`function run${id}(): string {
  let line = "${id}";
  for (let round = 0; round < ${pick([1, 2, 3])}; round++) {
    calls${id} = 0;
    worked${id} = ${firsts ? `round ? ${firsts} : 0` : "0"};
    again${id} = direct${id} = 0;
    try {
      line += ${down}(0) === 0 ? " fine" : " another result";
    } catch (error) {
      line += error instanceof RangeError ? " fine" : " thrown " + String(error);
    }
  }
  return line;
}`);
  }
  text.push(Array.from({ length: cases }, (_, at) => `console.log(run${at + 1}());`).join("\n"));
  text.push(`await new Promise(resolve => setTimeout(resolve, 5));
console.log("strange: " + [...strange].sort().join(", "));
console.log("wrong: " + [...wrong].sort().join(", "));
console.log("behind it: " + [${used.map((_, at) => `probe${at}()`).join(", ")}].map((answer, at) => (answer === expected[at] ? "as before" : "ANOTHER")).join(", "));`);
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
