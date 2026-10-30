import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Every way of reaching a global, for every kind of global that a host may replace through the `globals` of a Bun.ModuleGraph:
// a host that gives each graph its own process, timers, fetch, Bun, globalThis and so on. There is no list of expected values: the
// same program is built with --compile, without and with --aot, and says the same.

// name: [the stand-in, as text that the host evaluates, [[form, expression], ..]]
type Names = Record<string, [string, [string, string][]]>;
const host: Names = {
  process: [
    'Object.create(process, { mark: { value: "process" }, env: { value: { TENANT: "own" }, enumerable: true }, platform: { value: "tenant-os" }, pid: { value: 41 }, cwd: { value: () => "/tenant" }, argv: { value: ["a", "b"] }, nextTick: { value: (f: () => void) => "own tick" } })',
    [
      ["env", "process.env.TENANT"],
      ["env missing", "process.env.HOME === undefined"],
      ["platform", "process.platform"],
      ["pid", "process.pid === 41"],
      ["cwd()", "process.cwd()"],
      ["argv", "process.argv.length"],
      ["nextTick", "process.nextTick(() => {})"],
      ["inherited", "typeof process.hrtime"],
      [
        "env in a loop",
        '(() => { let all = ""; for (let i = 0; i < 3; i++) all += process.env.TENANT; return all; })()',
      ],
    ],
  ],
  setTimeout: [
    'Object.assign(function standIn() { return { mark: "timer" }; }, { mark: "setTimeout" })',
    [
      ["call", "setTimeout(() => {}, 1 << 30)"],
      [
        "call in a loop",
        "(() => { let last: unknown; for (let i = 0; i < 3; i++) last = setTimeout(() => {}, 1 << 30); return last; })()",
      ],
    ],
  ],
  setInterval: [
    'Object.assign(function standIn() { return { mark: "timer" }; }, { mark: "setInterval" })',
    [["call", "setInterval(() => {}, 1 << 30)"]],
  ],
  setImmediate: [
    'Object.assign(function standIn() { return { mark: "timer" }; }, { mark: "setImmediate" })',
    [["call", "setImmediate(() => {})"]],
  ],
  clearTimeout: [
    'Object.assign(function standIn() { return "cleared"; }, { mark: "clearTimeout" })',
    [["call", "clearTimeout(undefined)"]],
  ],
  clearInterval: [
    'Object.assign(function standIn() { return "cleared"; }, { mark: "clearInterval" })',
    [["call", "clearInterval(undefined)"]],
  ],
  clearImmediate: [
    'Object.assign(function standIn() { return "cleared"; }, { mark: "clearImmediate" })',
    [["call", "clearImmediate(undefined)"]],
  ],
  AbortSignal: [
    'Object.assign(class Own { static mark = "AbortSignal"; static abort() { return "own abort"; } static timeout() { return "own timeout"; } static any() { return "own any"; } }, {})',
    [
      ["abort()", "AbortSignal.abort()"],
      ["timeout()", "AbortSignal.timeout(1 << 30)"],
      ["any()", "AbortSignal.any([])"],
      ["instanceof", "new AbortController().signal instanceof AbortSignal"],
      ["prototype", "AbortSignal.prototype === Object.getPrototypeOf(new AbortController().signal)"],
      [
        "heir",
        "(() => { try { return Object.getPrototypeOf(class extends (AbortSignal as any) {}) === AbortSignal; } catch (error) { return (error as Error).name; } })()",
      ],
    ],
  ],
  fetch: [
    'Object.assign(function standIn() { return Promise.resolve("own response"); }, { mark: "fetch" })',
    [
      ["call", 'fetch("http://127.0.0.1:1/")'],
      ["member", "typeof fetch.preconnect"],
    ],
  ],
  Bun: [
    'Object.create(Bun, { mark: { value: "Bun" }, version: { value: "own version" }, env: { value: { TENANT: "own" } }, nanoseconds: { value: () => 41 }, inspect: { value: () => "own inspect" }, isMainThread: { value: "own" }, sleep: { value: () => Promise.resolve("own sleep") }, hash: { value: () => 41 }, file: { value: () => "own file" }, gc: { value: () => "own gc" }, stringWidth: { value: () => 41 }, escapeHTML: { value: () => "own" }, deepEquals: { value: () => "own" }, main: { value: "own main" }, argv: { value: ["own"] } })',
    [
      ["version", "Bun.version"],
      ["env", "Bun.env.TENANT"],
      ["nanoseconds()", "Bun.nanoseconds() === 41"],
      ["inspect()", "Bun.inspect(1)"],
      ["isMainThread", "Bun.isMainThread"],
      ["sleep()", "Bun.sleep(0)"],
      ["hash()", 'Bun.hash("a")'],
      ["file()", 'Bun.file("/x")'],
      ["gc()", "typeof Bun.gc(false)"],
      ["stringWidth()", 'Bun.stringWidth("abc")'],
      ["escapeHTML()", 'Bun.escapeHTML("<")'],
      ["deepEquals()", "Bun.deepEquals(1, 1)"],
      ["main", "Bun.main"],
      ["argv", "Bun.argv.length"],
      ["inherited", "typeof Bun.ModuleGraph"],
      [
        "stringWidth() in a loop",
        '(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += Bun.stringWidth("abc"); return sum; })()',
      ],
      ["imported member", "importedNanoseconds() === 41"],
      ["imported default", "ImportedBun"],
      ["imported namespace", "importedNamespace.version"],
      ['import("bun")', 'import("bun").then(found => found.version)'],
      ['require("bun")', 'require("bun").version'],
    ],
  ],
  postMessage: [
    'Object.assign(function standIn() { return "posted"; }, { mark: "postMessage" })',
    [["call", "(postMessage as any)(1)"]],
  ],
  onmessage: ['"own onmessage"', []],
  addEventListener: [
    'Object.assign(function standIn() { return "added"; }, { mark: "addEventListener" })',
    [["call", 'addEventListener("x", () => {})']],
  ],
  removeEventListener: [
    'Object.assign(function standIn() { return "removed"; }, { mark: "removeEventListener" })',
    [["call", 'removeEventListener("x", () => {})']],
  ],
  dispatchEvent: [
    'Object.assign(function standIn() { return true; }, { mark: "dispatchEvent" })',
    [["call", 'dispatchEvent(new Event("x"))']],
  ],
  close: ['Object.assign(function standIn() { return "closed"; }, { mark: "close" })', []],
};
const objects: Names = {
  globalThis: [
    'new Proxy(globalThis, { get: (target, key) => (asked.push(String(key)), key === "mark" ? "view" : key === "setTimeout" ? viewsSetTimeout : key === "performance" ? { now: () => 41 } : key === "onlyInView" ? 7 : Reflect.get(target, key)), has: (target, key) => key === "onlyInView" || (key !== "fetch" && Reflect.has(target, key)), set: (target, key, value) => { written.push(String(key)); return true; } })',
    [
      ["member", "globalThis.setTimeout"],
      ["member by a string", 'globalThis["setTimeout"]'],
      ["member call", "globalThis.performance.now() === 41"],
      ["a built-in is asked of it", "globalThis.Math.floor(1.5)"],
      [
        "a built-in is asked of it, in a loop",
        "(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += globalThis.Math.floor(1.5); return sum; })()",
      ],
      ["a built-in class is asked of it", "new globalThis.Map().size"],
      ["a built-in function is asked of it", 'globalThis.parseInt("7")'],
      ['imported from "bun": a member', "importedNanoseconds() === 41"],
      ['imported from "bun": the default', "ImportedBun"],
      ['imported from "bun": the namespace', "importedNamespace.version"],
      ['import("bun")', 'import("bun").then(found => found.version)'],
      ['require("bun")', 'require("bun").version'],
      ["member the real one lacks", "(globalThis as any).onlyInView"],
      ["member that falls through", "globalThis.clearTimeout === clearTimeout"],
      ["in", '"onlyInView" in globalThis'],
      ["in, hidden", '"fetch" in globalThis'],
      ["store", '(() => { (globalThis as any).stored = 1; return "stored" in globalThis; })()'],
      ["destructured", "(() => { const { setTimeout: found } = globalThis; return found; })()"],
      ["typeof member", "typeof globalThis.setTimeout"],
      [
        "member in a loop",
        "(() => { let last: unknown; for (let i = 0; i < 3; i++) last = globalThis.setTimeout; return last; })()",
      ],
      ["itself again", "(globalThis as any).globalThis === globalThis"],
    ],
  ],
  global: [
    'new Proxy(globalThis, { get: (target, key) => (asked.push(String(key)), key === "mark" ? "view" : key === "setTimeout" ? viewsSetTimeout : key === "performance" ? { now: () => 41 } : key === "onlyInView" ? 7 : Reflect.get(target, key)), has: (target, key) => key === "onlyInView" || (key !== "fetch" && Reflect.has(target, key)), set: (target, key, value) => { written.push(String(key)); return true; } })',
    [
      ["member", "global.setTimeout"],
      ["member by a string", 'global["setTimeout"]'],
      ["member call", "global.performance.now() === 41"],
      ["a built-in is asked of it", "global.Math.floor(1.5)"],
      [
        "a built-in is asked of it, in a loop",
        "(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += global.Math.floor(1.5); return sum; })()",
      ],
      ["a built-in class is asked of it", "new global.Map().size"],
      ["a built-in function is asked of it", 'global.parseInt("7")'],
      ['imported from "bun": a member', "importedNanoseconds() === 41"],
      ['imported from "bun": the default', "ImportedBun"],
      ['imported from "bun": the namespace', "importedNamespace.version"],
      ['import("bun")', 'import("bun").then(found => found.version)'],
      ['require("bun")', 'require("bun").version'],
      ["member the real one lacks", "(global as any).onlyInView"],
      ["member that falls through", "global.clearTimeout === clearTimeout"],
      ["in", '"onlyInView" in global'],
      ["in, hidden", '"fetch" in global'],
      ["store", '(() => { (global as any).stored = 1; return "stored" in globalThis; })()'],
      ["destructured", "(() => { const { setTimeout: found } = global; return found; })()"],
      ["typeof member", "typeof global.setTimeout"],
      [
        "member in a loop",
        "(() => { let last: unknown; for (let i = 0; i < 3; i++) last = global.setTimeout; return last; })()",
      ],
      ["itself again", "(global as any).global === global"],
    ],
  ],
  self: [
    'new Proxy(globalThis, { get: (target, key) => (asked.push(String(key)), key === "mark" ? "view" : key === "setTimeout" ? viewsSetTimeout : key === "performance" ? { now: () => 41 } : key === "onlyInView" ? 7 : Reflect.get(target, key)), has: (target, key) => key === "onlyInView" || (key !== "fetch" && Reflect.has(target, key)), set: (target, key, value) => { written.push(String(key)); return true; } })',
    [
      ["member", "self.setTimeout"],
      ["member by a string", 'self["setTimeout"]'],
      ["member call", "self.performance.now() === 41"],
      ["a built-in is asked of it", "self.Math.floor(1.5)"],
      [
        "a built-in is asked of it, in a loop",
        "(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += self.Math.floor(1.5); return sum; })()",
      ],
      ["a built-in class is asked of it", "new self.Map().size"],
      ["a built-in function is asked of it", 'self.parseInt("7")'],
      ['imported from "bun": a member', "importedNanoseconds() === 41"],
      ['imported from "bun": the default', "ImportedBun"],
      ['imported from "bun": the namespace', "importedNamespace.version"],
      ['import("bun")', 'import("bun").then(found => found.version)'],
      ['require("bun")', 'require("bun").version'],
      ["member the real one lacks", "(self as any).onlyInView"],
      ["member that falls through", "self.clearTimeout === clearTimeout"],
      ["in", '"onlyInView" in self'],
      ["in, hidden", '"fetch" in self'],
      ["store", '(() => { (self as any).stored = 1; return "stored" in globalThis; })()'],
      ["destructured", "(() => { const { setTimeout: found } = self; return found; })()"],
      ["typeof member", "typeof self.setTimeout"],
      [
        "member in a loop",
        "(() => { let last: unknown; for (let i = 0; i < 3; i++) last = self.setTimeout; return last; })()",
      ],
      ["itself again", "(self as any).self === self"],
    ],
  ],
};
const language: Names = {
  Math: [
    'Object.create(Math, { mark: { value: "Math" }, floor: { value: () => 41 }, max: { value: () => 42 }, abs: { value: () => 43 }, sqrt: { value: () => 44 }, PI: { value: 45 }, imul: { value: () => 46 }, random: { value: () => 47 }, min: { value: () => 48 }, round: { value: () => 49 }, trunc: { value: () => 50 } })',
    [
      ["floor()", "Math.floor(1.5)"],
      ["max()", "Math.max(1, 2)"],
      ["abs()", "Math.abs(-1)"],
      ["sqrt()", "Math.sqrt(4)"],
      ["PI", "Math.PI"],
      ["imul()", "Math.imul(2, 3)"],
      ["random()", "Math.random() === 47"],
      ["min()", "Math.min(1, 2)"],
      ["round()", "Math.round(1.5)"],
      ["trunc()", "Math.trunc(1.5)"],
      ["inherited", "Math.ceil(1.5)"],
      [
        "floor() in a loop",
        "(() => { let sum = 0; for (let i = 0; i < 4; i++) sum += Math.floor(i / 2); return sum; })()",
      ],
      ["detached", "(() => { const { floor } = Math; return floor(1.5); })()"],
    ],
  ],
  JSON: [
    '{ mark: "JSON", stringify: () => "own text", parse: () => "own value", [Symbol.toStringTag]: "JSON" }',
    [
      ["stringify()", "JSON.stringify({ a: 1 })"],
      ["parse()", 'JSON.parse("[1]")'],
      ["parse() as a type", "(JSON.parse('{\"x\":1}') as unknown)"],
    ],
  ],
  Object: [
    'Object.assign(function Own() { return { mark: "made" }; }, { mark: "Object", keys: () => ["own"], assign: () => "own assign", create: () => "own create", entries: () => [], freeze: (value: unknown) => "own freeze", getPrototypeOf: () => "own prototype", defineProperty: () => "own define", is: () => "own is", values: () => ["own"], fromEntries: () => "own", hasOwn: () => "own", getOwnPropertyNames: () => ["own"] })',
    [
      ["keys()", "Object.keys({ a: 1 })"],
      ["assign()", "Object.assign({}, { a: 1 })"],
      ["create()", "Object.create(null)"],
      ["entries()", "Object.entries({ a: 1 })"],
      ["freeze()", "Object.freeze({ a: 1 })"],
      ["getPrototypeOf()", 'Object.getPrototypeOf([]) === "own prototype"'],
      ["is()", "Object.is(1, 1)"],
      ["values()", "Object.values({ a: 1 })"],
      ["fromEntries()", 'Object.fromEntries([["a", 1]])'],
      ["hasOwn()", 'Object.hasOwn({ a: 1 }, "a")'],
      ["call", "Object(1)"],
      ["new", "new Object()"],
      [
        "instanceof",
        "(() => { try { return ({}) instanceof Object; } catch (error) { return (error as Error).name; } })()",
      ],
      [
        "a literal is not made by it",
        "Reflect.getPrototypeOf({}) === Reflect.getPrototypeOf(Reflect.getPrototypeOf(() => {})!)",
      ],
    ],
  ],
  Array: [
    'Object.assign(function Own() { return ["made"]; }, { mark: "Array", isArray: () => "own isArray", from: () => ["own from"], of: () => ["own of"] })',
    [
      ["isArray()", "Array.isArray([])"],
      ["from()", "Array.from([1])"],
      ["of()", "Array.of(1)"],
      ["new", "new Array(3)"],
      ["call", "Array(3)"],
      [
        "instanceof",
        "(() => { try { return [] instanceof Array; } catch (error) { return (error as Error).name; } })()",
      ],
      ["a literal is not made by it", "[1, 2].map(x => x + 1)"],
    ],
  ],
  Promise: [
    'Object.assign(function Own() { return { mark: "made" }; }, { mark: "Promise", resolve: () => "own resolve", reject: () => "own reject", all: () => "own all", withResolvers: () => "own", race: () => "own race", allSettled: () => "own" })',
    [
      ["resolve()", "Promise.resolve(1)"],
      ["all()", "Promise.all([])"],
      ["race()", "Promise.race([])"],
      ["withResolvers()", "Promise.withResolvers()"],
      ["new", "new Promise(() => {})"],
      ["an async function does not use it", "(async () => 5)()"],
      [
        "instanceof",
        "(() => { try { return (async () => {})() instanceof Promise; } catch (error) { return (error as Error).name; } })()",
      ],
    ],
  ],
  Symbol: [
    'Object.assign(function Own() { return "own symbol"; }, { mark: "Symbol", iterator: "own iterator", for: () => "own for", asyncIterator: "own", hasInstance: "own", toPrimitive: "own", dispose: "own" })',
    [
      ["iterator", "Symbol.iterator"],
      ["for()", 'Symbol.for("a")'],
      ["call", 'Symbol("a")'],
      ["for-of does not use it", "(() => { let sum = 0; for (const x of [1, 2]) sum += x; return sum; })()"],
      [
        "as a key",
        "(() => { const holder = { [Symbol.iterator]: 1 }; return Reflect.ownKeys(holder).map(key => typeof key); })()",
      ],
    ],
  ],
  Number: [
    'Object.assign(function Own() { return 41; }, { mark: "Number", isInteger: () => "own", parseFloat: () => 42, MAX_SAFE_INTEGER: 43, isFinite: () => "own", isNaN: () => "own", EPSILON: 44, isSafeInteger: () => "own", parseInt: () => 45 })',
    [
      ["call", 'Number("1")'],
      ["isInteger()", "Number.isInteger(1)"],
      ["parseFloat()", 'Number.parseFloat("1")'],
      ["MAX_SAFE_INTEGER", "Number.MAX_SAFE_INTEGER"],
      ["isFinite()", "Number.isFinite(1)"],
      ["isNaN()", "Number.isNaN(1)"],
      ["parseInt()", 'Number.parseInt("1")'],
      ["new", "typeof new Number(1)"],
    ],
  ],
  String: [
    'Object.assign(function Own() { return "own string"; }, { mark: "String", fromCharCode: () => "own char", raw: () => "own raw", fromCodePoint: () => "own point" })',
    [
      ["call", "String(1)"],
      ["fromCharCode()", "String.fromCharCode(65)"],
      ["raw", "String.raw`a`"],
      ["fromCodePoint()", "String.fromCodePoint(65)"],
      ["a template does not use it", "`${1}`"],
      ["call in a loop", '(() => { let all = ""; for (let i = 0; i < 3; i++) all += String(i); return all; })()'],
    ],
  ],
  Boolean: [
    'Object.assign(function standIn() { return "own boolean"; }, { mark: "Boolean" })',
    [
      ["call", "Boolean(0)"],
      ["as a callback", "[0, 1].filter(Boolean)"],
    ],
  ],
  Error: [
    'Object.assign(function Own(this: unknown) { return { mark: "made", message: "own message", name: "Own" }; }, { mark: "Error", captureStackTrace: () => "own capture", isError: () => "own" })',
    [
      ["new", 'new Error("x").message'],
      ["call", 'Error("x").message'],
      ["captureStackTrace()", "Error.captureStackTrace({})"],
      [
        "instanceof",
        "(() => { try { (null as any).x; } catch (error) { try { return error instanceof Error; } catch (second) { return (second as any).name; } } })()",
      ],
      [
        "heir",
        '(() => { try { class Mine extends Error {} return new Mine("x").message; } catch (error) { return "throws " + (error as any).name; } })()',
      ],
    ],
  ],
  TypeError: [
    'Object.assign(function Own() { return { mark: "made", message: "own message" }; }, { mark: "TypeError" })',
    [
      ["new", 'new TypeError("x").message'],
      [
        "what the engine throws is not made by it",
        "(() => { try { (null as any).x; } catch (error) { return (error as any).constructor === TypeError; } })()",
      ],
    ],
  ],
  Map: [
    'Object.assign(function Own() { return { mark: "made", size: 41 }; }, { mark: "Map", groupBy: () => "own" })',
    [
      ["new", "new Map().size"],
      ["new with entries", "new Map([[1, 2]]).size"],
      ["groupBy()", "Map.groupBy([], () => 1)"],
      [
        "new in a loop",
        "(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += new Map<number, number>().size; return sum; })()",
      ],
    ],
  ],
  Set: [
    'Object.assign(function Own() { return { mark: "made", size: 41 }; }, { mark: "Set" })',
    [
      ["new", "new Set().size"],
      ["new with values", "new Set([1, 2]).size"],
    ],
  ],
  WeakMap: [
    'Object.assign(function Own() { return { mark: "made" }; }, { mark: "WeakMap" })',
    [["new", "new WeakMap()"]],
  ],
  Date: [
    'Object.assign(function Own() { return { mark: "made", getTime: () => 41 }; }, { mark: "Date", now: () => 42, UTC: () => 43, parse: () => 44 })',
    [
      ["now()", "Date.now()"],
      ["new", "new Date().getTime()"],
      ["new with a number", "new Date(5).getTime()"],
      ["UTC()", "Date.UTC(2000, 1)"],
      ["parse()", 'Date.parse("2000")'],
    ],
  ],
  RegExp: [
    'Object.assign(function Own() { return { mark: "made", test: () => "own test", source: "own source" }; }, { mark: "RegExp", escape: () => "own" })',
    [
      ["new", 'new RegExp("a").source'],
      ["call", 'RegExp("a").source'],
      ["new, then test()", 'new RegExp("a").test("a")'],
      ["a literal is not made by it", "/a/.source"],
    ],
  ],
  Reflect: [
    '{ mark: "Reflect", get: () => "own get", has: () => "own has", ownKeys: () => ["own"], apply: () => "own apply", construct: () => "own construct", getPrototypeOf: () => "own", set: () => "own set", defineProperty: () => "own" }',
    [
      ["get()", 'Reflect.get({ a: 1 }, "a")'],
      ["has()", 'Reflect.has({ a: 1 }, "a")'],
      ["ownKeys()", "Reflect.ownKeys({ a: 1 })"],
      ["apply()", "Reflect.apply(() => 1, null, [])"],
      ["construct()", "Reflect.construct(class {}, [])"],
    ],
  ],
  BigInt: [
    'Object.assign(function Own() { return "own bigint"; }, { mark: "BigInt", asUintN: () => "own" })',
    [
      ["call", "typeof BigInt(1)"],
      ["asUintN()", "typeof BigInt.asUintN(8, 1n)"],
    ],
  ],
  Uint8Array: [
    'Object.assign(function Own() { return { mark: "made", length: 41 }; }, { mark: "Uint8Array", from: () => "own from", of: () => "own of", BYTES_PER_ELEMENT: 42 })',
    [
      ["new", "new Uint8Array(3).length"],
      ["from()", "Uint8Array.from([1])"],
      ["BYTES_PER_ELEMENT", "Uint8Array.BYTES_PER_ELEMENT"],
      [
        "new in a loop",
        "(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += new Uint8Array(2).length; return sum; })()",
      ],
    ],
  ],
  ArrayBuffer: [
    'Object.assign(function Own() { return { mark: "made", byteLength: 41 }; }, { mark: "ArrayBuffer", isView: () => "own" })',
    [
      ["new", "new ArrayBuffer(3).byteLength"],
      ["isView()", "ArrayBuffer.isView(1)"],
    ],
  ],
  parseInt: [
    'Object.assign(function standIn() { return 41; }, { mark: "parseInt" })',
    [
      ["call", 'parseInt("1")'],
      ["call with a radix", 'parseInt("11", 2)'],
    ],
  ],
  parseFloat: [
    'Object.assign(function standIn() { return 41; }, { mark: "parseFloat" })',
    [["call", 'parseFloat("1.5")']],
  ],
  isNaN: ['Object.assign(function standIn() { return "own"; }, { mark: "isNaN" })', [["call", "isNaN(1)"]]],
  isFinite: ['Object.assign(function standIn() { return "own"; }, { mark: "isFinite" })', [["call", "isFinite(1)"]]],
  undefined: [
    '"own undefined"',
    [
      ["compared", "(void 0) === undefined"],
      ["a missing argument is not it", "((x?: unknown) => x)()"],
      ["as a default", "(() => { let x; return x === undefined; })()"],
    ],
  ],
  NaN: [
    "41",
    [
      ["compared", "((a: unknown, b: unknown) => a === b)(NaN, NaN)"],
      ["arithmetic", "NaN + 1"],
    ],
  ],
  Infinity: [
    "41",
    [
      ["arithmetic", "Infinity + 1"],
      ["negated", "-Infinity"],
    ],
  ],
  Function: [
    'Object.assign(function Own() { return () => "own function"; }, { mark: "Function" })',
    [
      [
        "instanceof",
        "(() => { try { return (() => {}) instanceof Function; } catch (error) { return (error as Error).name; } })()",
      ],
      ["prototype", "typeof Function.prototype"],
    ],
  ],
  Proxy: [
    'Object.assign(function Own() { return { mark: "made" }; }, { mark: "Proxy", revocable: () => "own" })',
    [
      ["new", "new Proxy({}, {})"],
      ["revocable()", "Proxy.revocable({}, {})"],
    ],
  ],
  console: [
    'Object.create(console, { mark: { value: "console" }, log: { value: () => "own log" }, error: { value: () => "own error" }, warn: { value: () => "own warn" } })',
    [
      ["log()", 'console.log("not printed")'],
      ["error()", 'console.error("not printed")'],
      ["inherited", "typeof console.table"],
    ],
  ],
  Buffer: [
    'Object.assign(function Own() { return "own"; }, { mark: "Buffer", from: () => "own from", alloc: () => "own alloc", isBuffer: () => "own", byteLength: () => 41, concat: () => "own concat", allocUnsafe: () => "own" })',
    [
      ["from()", 'Buffer.from("a")'],
      ["alloc()", "Buffer.alloc(1)"],
      ["isBuffer()", "Buffer.isBuffer(1)"],
      ["byteLength()", 'Buffer.byteLength("abc")'],
      ["concat()", "Buffer.concat([])"],
      ["imported", "ImportedBuffer"],
    ],
  ],
  URL: [
    'Object.assign(function Own() { return { mark: "made", href: "own href", pathname: "own path" }; }, { mark: "URL", canParse: () => "own", parse: () => "own parse" })',
    [
      ["new", 'new URL("http://a/b").href'],
      ["pathname", 'new URL("http://a/b").pathname'],
      ["canParse()", 'URL.canParse("http://a")'],
      [
        "instanceof",
        "(() => { try { return realURL instanceof URL; } catch (error) { return (error as Error).name; } })()",
      ],
    ],
  ],
  URLSearchParams: [
    'Object.assign(function Own() { return { mark: "made", get: () => "own get", size: 41 }; }, { mark: "URLSearchParams" })',
    [
      ["new", 'new URLSearchParams("a=1").get("a")'],
      ["size", 'new URLSearchParams("a=1").size'],
    ],
  ],
  Request: [
    'Object.assign(function Own() { return { mark: "made", url: "own url", method: "OWN" }; }, { mark: "Request" })',
    [
      ["new", 'new Request("http://a/").url'],
      ["method", 'new Request("http://a/").method'],
      [
        "instanceof",
        "(() => { try { return realRequest instanceof Request; } catch (error) { return (error as Error).name; } })()",
      ],
    ],
  ],
  Response: [
    'Object.assign(function Own() { return { mark: "made", status: 41, ok: "own" }; }, { mark: "Response", json: () => "own json", redirect: () => "own redirect", error: () => "own error" })',
    [
      ["new", 'new Response("a").status'],
      ["json()", "Response.json({})"],
      ["redirect()", 'Response.redirect("http://a/")'],
      [
        "instanceof",
        "(() => { try { return realResponse instanceof Response; } catch (error) { return (error as Error).name; } })()",
      ],
      [
        "new in a loop",
        '(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += new Response("a").status; return sum; })()',
      ],
    ],
  ],
  Headers: [
    'Object.assign(function Own() { return { mark: "made", get: () => "own get", has: () => "own has" }; }, { mark: "Headers" })',
    [
      ["new", 'new Headers({ a: "1" }).get("a")'],
      ["has()", 'new Headers({ a: "1" }).has("a")'],
    ],
  ],
  Blob: [
    'Object.assign(function Own() { return { mark: "made", size: 41, type: "own" }; }, { mark: "Blob" })',
    [
      ["new", 'new Blob(["abc"]).size'],
      ["type", 'new Blob(["abc"]).type'],
    ],
  ],
  TextEncoder: [
    'Object.assign(function Own() { return { mark: "made", encode: () => "own encode" }; }, { mark: "TextEncoder" })',
    [["new", 'new TextEncoder().encode("a")']],
  ],
  TextDecoder: [
    'Object.assign(function Own() { return { mark: "made", decode: () => "own decode" }; }, { mark: "TextDecoder" })',
    [["new", "new TextDecoder().decode(new Uint8Array([65]))"]],
  ],
  queueMicrotask: [
    'Object.assign(function standIn() { return "queued"; }, { mark: "queueMicrotask" })',
    [["call", "queueMicrotask(() => {})"]],
  ],
  structuredClone: [
    'Object.assign(function standIn() { return "cloned"; }, { mark: "structuredClone" })',
    [["call", "structuredClone({ a: 1 })"]],
  ],
  performance: [
    'Object.create(performance, { mark: { value: "performance" }, now: { value: () => 41 }, timeOrigin: { value: 42 } })',
    [
      ["now()", "performance.now()"],
      ["timeOrigin", "performance.timeOrigin"],
      [
        "now() in a loop",
        "(() => { let sum = 0; for (let i = 0; i < 3; i++) sum += performance.now(); return sum; })()",
      ],
    ],
  ],
  crypto: [
    'Object.create(crypto, { mark: { value: "crypto" }, randomUUID: { value: () => "own uuid" }, getRandomValues: { value: () => "own values" } })',
    [
      ["randomUUID()", "crypto.randomUUID().length"],
      ["getRandomValues()", "typeof crypto.getRandomValues(new Uint8Array(1))"],
    ],
  ],
  AbortController: [
    'Object.assign(function Own() { return { mark: "made", signal: "own signal" }; }, { mark: "AbortController" })',
    [["new", "typeof new AbortController().signal"]],
  ],
  Event: [
    'Object.assign(function Own() { return { mark: "made", type: "own type" }; }, { mark: "Event" })',
    [["new", 'new Event("x").type']],
  ],
  EventTarget: [
    'Object.assign(function Own() { return { mark: "made" }; }, { mark: "EventTarget" })',
    [["new", "typeof new EventTarget().addEventListener"]],
  ],
  Intl: [
    '{ mark: "Intl", NumberFormat: function Own() { return { format: () => "own format" }; }, DateTimeFormat: function Own() { return { format: () => "own format" }; }, Collator: function Own() { return { compare: () => 41 }; } }',
    [
      ["NumberFormat", 'new Intl.NumberFormat("en").format(1)'],
      ["DateTimeFormat", 'new Intl.DateTimeFormat("en", { timeZone: "UTC" }).format(0)'],
      ["Collator", 'new Intl.Collator("en").compare("a", "b")'],
    ],
  ],
  WebSocket: [
    'Object.assign(function Own() { return { mark: "made" }; }, { mark: "WebSocket", OPEN: 41 })',
    [["OPEN", "WebSocket.OPEN"]],
  ],
  Worker: ['Object.assign(function Own() { return { mark: "made" }; }, { mark: "Worker" })', []],
  navigator: [
    '{ mark: "navigator", userAgent: "own agent", hardwareConcurrency: 41 }',
    [
      ["userAgent", "navigator.userAgent"],
      ["hardwareConcurrency", "navigator.hardwareConcurrency"],
    ],
  ],
  encodeURIComponent: [
    'Object.assign(function standIn() { return "own"; }, { mark: "encodeURIComponent" })',
    [["call", 'encodeURIComponent("a b")']],
  ],
  atob: ['Object.assign(function standIn() { return "own"; }, { mark: "atob" })', [["call", 'atob("YQ==")']]],
  WeakRef: [
    'Object.assign(function Own() { return { mark: "made", deref: () => "own deref" }; }, { mark: "WeakRef" })',
    [["new", "new WeakRef({}).deref()"]],
  ],
  Iterator: [
    'Object.assign(function Own() {}, { mark: "Iterator", from: () => "own from" })',
    [["from()", "Iterator.from([1])"]],
  ],
  DataView: [
    'Object.assign(function Own() { return { mark: "made", byteLength: 41 }; }, { mark: "DataView" })',
    [["new", "new DataView(new ArrayBuffer(2)).byteLength"]],
  ],
  Float64Array: [
    'Object.assign(function Own() { return { mark: "made", length: 41 }; }, { mark: "Float64Array" })',
    [["new", "new Float64Array(3).length"]],
  ],
  ReadableStream: [
    'Object.assign(function Own() { return { mark: "made", locked: "own" }; }, { mark: "ReadableStream" })',
    [["new", "new ReadableStream().locked"]],
  ],
  FormData: [
    'Object.assign(function Own() { return { mark: "made", has: () => "own" }; }, { mark: "FormData" })',
    [["new", 'new FormData().has("a")']],
  ],
};
const all: Names = { ...host, ...objects, ...language };
const notDeclared = new Set(["close", "onmessage"]);
const setToUndefined = [
  "process",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "AbortSignal",
  "fetch",
  "Bun",
  "postMessage",
  "onmessage",
  "addEventListener",
  "removeEventListener",
  "dispatchEvent",
  "close",
  "Math",
  "JSON",
  "Object",
  "Promise",
  "Symbol",
  "console",
  "Response",
  "URL",
  "Buffer",
  "undefined",
  "Map",
  "parseInt",
  "globalThis",
  "self",
];
const general: [string, string][] = [
  ["read", "$NAME"],
  ["typeof", "typeof $NAME"],
  ["read in a nested function", "(() => () => $NAME)()()"],
  ["read in a loop", "(() => { let last: unknown; for (let i = 0; i < 3; i++) last = $NAME; return last; })()"],
  ["read in a method", "new (class { read() { return $NAME; } })().read()"],
  ["read in an async function", "(async () => $NAME)()"],
  ["read after an await", "(async () => { await 1; return $NAME; })()"],
  ["read in a generator", "(function* () { yield $NAME; })().next().value"],
  ["read as a default", "((value: unknown = $NAME) => value)()"],
  ["read when the module ran", "whenTheModuleRan[$QUOTED]"],
  ["read in a callback of a built-in", "[0].map(() => $NAME)[0]"],
  ["read in a getter", "({ get it() { return $NAME; } }).it"],
  ["read twice, the same", "((a: unknown, b: unknown) => a === b)($NAME, $NAME)"],
  ["shorthand", "({ $NAME })[$QUOTED]"],
  ["optional member", "($NAME as any)?.mark"],
];
const throughTheObject: [string, string][] = [
  ["globalThis.name", "(globalThis as any).$NAME"],
  ['globalThis["name"]', "(globalThis as any)[$QUOTED]"],
  ["global.name", "(global as any).$NAME"],
  ["self.name", "(self as any).$NAME"],
  ["name in globalThis", "$QUOTED in globalThis"],
  ["typeof globalThis.name", "typeof (globalThis as any).$NAME"],
  ["globalThis by a computed key", "(globalThis as any)[computed($QUOTED)]"],
  ["Reflect.get(globalThis, name)", "Reflect.get(globalThis, $QUOTED)"],
];
const runTimeText: [string, string][] = [
  ["direct eval", "eval($QUOTED)"],
  ["direct eval, typeof", 'eval("typeof " + $QUOTED)'],
  ["indirect eval", '(0, eval)("typeof " + $QUOTED)'],
  ["new Function", 'new Function("return typeof " + $QUOTED)()'],
  ["direct eval in a nested function", "(() => () => eval($QUOTED))()()"],
];
const stores: [string, string][] = [
  ["store, then read", '(() => { $NAME = "stored"; return $NAME; })()'],
  ["after the store, through the object", 'globalThis[$QUOTED] === "stored"'],
  ["after the store, typeof", "typeof $NAME"],
  ["store in a direct eval, then read", '(() => { eval($QUOTED + " = \\"stored by eval\\""); return $NAME; })()'],
  ["store, then read in a direct eval", '(() => { $NAME = "stored again"; return eval($QUOTED); })()'],
];
const builtinModules: [string, string][] = [
  ["node:process", "ImportedProcess"],
  ["node:timers setTimeout", "importedSetTimeout"],
  ["node:timers clearTimeout", "importedClearTimeout"],
  ["node:timers setImmediate", "importedSetImmediate"],
  ["node:timers/promises", 'sleep(1, "slept")'],
  [
    "events.once with a signal",
    '(() => { const emitter = new EventEmitter(); const waiting = once(emitter, "x", { signal: new AbortController().signal }); emitter.emit("x", 5); return waiting; })()',
  ],
  ["util.promisify(setTimeout)", "typeof promisify(importedSetTimeout)"],
  ["util.inspect", "inspect({ a: [1, new Map([[1, 2]])] })"],
  ["Bun.sleep", 'importedNamespace.sleep(1).then(() => "slept")'],
  ['require("node:process")', 'require("node:process")'],
  ['import("node:process")', 'import("node:process").then(found => found.default)'],
  ["a stream of node:stream", 'import("node:stream").then(({ Readable }) => Readable.from(["a", "b"]).toArray())'],
  ["an emitter's error goes by the real process", "typeof new EventEmitter().on"],
  ["fs.promises", 'import("node:fs/promises").then(fs => fs.readFile("/dev/null", "utf8"))'],
  ["child_process is loaded", 'import("node:child_process").then(found => typeof found.spawn)'],
  ["node:http is loaded", 'import("node:http").then(found => typeof found.createServer)'],
];

const named = (rows: [string, string][], name: string) =>
  rows.map(
    ([form, text]) =>
      [form, text.replaceAll("$NAME", name).replaceAll("$QUOTED", JSON.stringify(name))] as [string, string],
  );
const withoutTypes = (text: string) =>
  text
    .replace(/ as (any|unknown|Error)\b/g, "")
    .replaceAll(": unknown", "")
    .replaceAll("<number, number>", "")
    .replaceAll("(x?)", "(x)")
    .replaceAll("(() => {})!)", "(() => {}))");
const listed = (rows: [string, string][], indent: string) =>
  rows.map(([form, text]) => `${indent}${JSON.stringify(form)}: () => ${text},`);

function formsOf(name: string, isTyped: boolean) {
  const rows = [...named(general, name), ...(name in objects ? [] : named(throughTheObject, name)), ...all[name]![1]];
  return isTyped
    ? rows
    : [...rows, ...named(runTimeText, name)].map(([form, text]) => [form, withoutTypes(text)] as [string, string]);
}

function moduleText(isTyped: boolean) {
  const names = Object.keys(all).filter(name => !isTyped || !notDeclared.has(name));
  return [
    'import { nanoseconds as importedNanoseconds } from "bun";\nimport ImportedBun from "bun";\nimport * as importedNamespace from "bun";\nimport { Buffer as ImportedBuffer } from "node:buffer";\nimport ImportedProcess from "node:process";\nimport { setTimeout as importedSetTimeout, clearTimeout as importedClearTimeout, setImmediate as importedSetImmediate } from "node:timers";\nimport { setTimeout as sleep } from "node:timers/promises";\nimport { once, EventEmitter } from "node:events";\nimport { promisify, inspect } from "node:util";\n{more}\nconst computed = (text{string}) => text.slice(0);\n'
      .replace(
        "{more}",
        isTyped
          ? 'import * as loose from "./loose.js";\nimport old from "./old.cjs";\nexport { loose, old };\ndeclare const realURL: URL, realRequest: Request, realResponse: Response, self: typeof globalThis;\ndeclare function dispatchEvent(event: Event): boolean;'
          : "",
      )
      .replace("{string}", isTyped ? ": string" : ""),
    `const whenTheModuleRan${isTyped ? ": Record<string, unknown>" : ""} = {`,
    ...names.map(name => `  ${JSON.stringify(name)}: typeof ${name} === "undefined" ? undefined : ${name},`),
    "};",
    `export const forms${isTyped ? ": Record<string, Record<string, () => unknown>>" : ""} = {`,
    ...names.flatMap(name => [
      `  ${JSON.stringify(name)}: {`,
      ...listed(formsOf(name, isTyped), "    "),
      "  },",
      ...(isTyped || ["undefined", "NaN", "Infinity"].includes(name)
        ? []
        : [`  ${JSON.stringify(name + ", stored to")}: {`, ...listed(named(stores, name), "    "), "  },"]),
    ]),
    '  "built-in modules": {',
    ...listed(
      builtinModules.map(([form, text]) => [form, isTyped ? text : withoutTypes(text)]),
      "    ",
    ),
    "  },",
    "};",
    `export function callHere(f${isTyped ? ": () => unknown" : ""}) { return f(); }`,
    "",
  ].join("\n");
}

function commonJSText() {
  return [
    "const whenTheModuleRan = {};",
    "const computed = text => text.slice(0);",
    "const forms = {};",
    ...Object.keys(all).flatMap(name => [
      `whenTheModuleRan[${JSON.stringify(name)}] = typeof ${name} === "undefined" ? undefined : ${name};`,
      `forms[${JSON.stringify(name)}] = {`,
      ...listed(
        [
          ...named([...general.slice(0, 4), ...general.slice(9, 10)], name),
          ...(name in objects ? [] : named(throughTheObject.slice(0, 1), name)),
        ].map(([form, text]) => [form, withoutTypes(text)]),
        "  ",
      ),
      "};",
    ]),
    "module.exports = { forms };",
    "",
  ].join("\n");
}

const entryText = String.raw`declare const realURL: unknown;
const url = new URL("./app.js", import.meta.url).href;
const written: string[] = [], asked: string[] = [];
const viewsSetTimeout = Object.assign(function standIn() { return { mark: "timer" }; }, { mark: "the view's setTimeout" });
const viewsBun = Object.create(Bun, { mark: { value: "the view's Bun" }, version: { value: "the view's version" }, nanoseconds: { value: () => 41 } });
const real = { realURL: new URL("http://real/"), realRequest: new Request("http://real/"), realResponse: new Response("real") };
const standIns: Record<string, () => unknown> = {
${Object.entries(all)
  .map(([name, [standIn]]) => `  ${JSON.stringify(name)}: () => (${standIn}),`)
  .join("\n")}
};
const literally: Record<string, (value: unknown) => Record<string, unknown>> = {
  Math: value => ({ globals: { Math: value } }).globals,
  JSON: value => ({ globals: { JSON: value } }).globals,
  Object: value => ({ globals: { Object: value } }).globals,
  Array: value => ({ globals: { Array: value } }).globals,
  Promise: value => ({ globals: { Promise: value } }).globals,
  Symbol: value => ({ globals: { Symbol: value } }).globals,
  Number: value => ({ globals: { Number: value } }).globals,
  String: value => ({ globals: { String: value } }).globals,
  Boolean: value => ({ globals: { Boolean: value } }).globals,
  Error: value => ({ globals: { Error: value } }).globals,
  TypeError: value => ({ globals: { TypeError: value } }).globals,
  Map: value => ({ globals: { Map: value } }).globals,
  Set: value => ({ globals: { Set: value } }).globals,
  WeakMap: value => ({ globals: { WeakMap: value } }).globals,
  Date: value => ({ globals: { Date: value } }).globals,
  RegExp: value => ({ globals: { RegExp: value } }).globals,
  Reflect: value => ({ globals: { Reflect: value } }).globals,
  BigInt: value => ({ globals: { BigInt: value } }).globals,
  Uint8Array: value => ({ globals: { Uint8Array: value } }).globals,
  ArrayBuffer: value => ({ globals: { ArrayBuffer: value } }).globals,
  parseInt: value => ({ globals: { parseInt: value } }).globals,
  parseFloat: value => ({ globals: { parseFloat: value } }).globals,
  isNaN: value => ({ globals: { isNaN: value } }).globals,
  isFinite: value => ({ globals: { isFinite: value } }).globals,
  Function: value => ({ globals: { Function: value } }).globals,
  Proxy: value => ({ globals: { Proxy: value } }).globals,
  Intl: value => ({ globals: { Intl: value } }).globals,
  encodeURIComponent: value => ({ globals: { encodeURIComponent: value } }).globals,
  WeakRef: value => ({ globals: { WeakRef: value } }).globals,
  Iterator: value => ({ globals: { Iterator: value } }).globals,
  DataView: value => ({ globals: { DataView: value } }).globals,
  Float64Array: value => ({ globals: { Float64Array: value } }).globals,
};
const hostNames = ${JSON.stringify([...Object.keys(host), ...Object.keys(objects)])};
const setToUndefined = ${JSON.stringify(setToUndefined)};
function describe(value: unknown, name: string, standIn: unknown): unknown {
  if (value === standIn && standIn !== undefined) return "the stand-in";
  if (value === globalThis) return "the real global object";
  if (name in globalThis && value === Reflect.get(globalThis, name) && (typeof value === "object" || typeof value === "function") && value !== null) return "the real one";
  if (typeof value === "function") return "a function " + ((value as any).mark ?? value.name);
  if (typeof value === "symbol" || typeof value === "bigint") return typeof value + " " + String(value);
  if (value === undefined) return "undefined";
  if (typeof value === "number" && !Number.isFinite(value)) return String(value);
  if (typeof value === "object" && value !== null) {
    if ((value as any).mark !== undefined) return "marked " + (value as any).mark;
    if (Array.isArray(value)) return value.map(item => describe(item, name, standIn));
    for (const other of Object.getOwnPropertyNames(globalThis)) if (other !== name && other !== "realURL" && Reflect.get(globalThis, other) === value) return "the real " + other;
    return "an object " + Object.prototype.toString.call(value);
  }
  return value;
}
async function readAll(rows: unknown[], graph: string, file: string, forms: Record<string, Record<string, () => unknown>>, names: string[], given: Record<string, unknown>, through?: (f: () => unknown) => unknown) {
  if (!forms) rows.push([graph, file, "", "the file's forms", "missing"]);
  for (const name of forms ? names : []) {
    for (const [form, read] of Object.entries(forms[name] ?? {})) {
      let value: unknown;
      try {
        const found = through ? through(read) : read();
        value = describe(found instanceof Promise ? await Promise.race([found, new Promise(resolve => setTimeout(resolve, 100, "a promise that stays pending"))]) : found, name, given[name]);
      } catch (error) {
        value = "throws " + (error as Error)?.name;
      }
      rows.push([graph, file, name, form, value]);
    }
  }
}
async function inGraph(rows: unknown[], label: string, given: Record<string, unknown>, names: string[], stores = true) {
  const before = Object.keys(given).map(name => [name, Reflect.getOwnPropertyDescriptor(globalThis, name)] as const);
  const app = await inGraphUnguarded(rows, label, given, names, stores);
  for (const [name, descriptor] of before) {
    const now = Reflect.getOwnPropertyDescriptor(globalThis, name);
    const isSame = descriptor?.value === now?.value && descriptor?.get === now?.get;
    rows.push([label, "", name, "the real global is as it was", isSame]);
    if (!isSame && descriptor) Reflect.defineProperty(globalThis, name, descriptor);
  }
  return app;
}
async function inGraphUnguarded(rows: unknown[], label: string, given: Record<string, unknown>, names: string[], stores: boolean) {
  let app: any;
  const graph = new Bun.ModuleGraph({ globals: { ...real, ...given }, onError: (error, kind) => void rows.push([label, "", "", "onError " + kind, (error as Error)?.name]) });
  try {
    app = await graph.import(url);
  } catch (error) {
    rows.push([label, "", Object.keys(given).join(), "import", "throws " + (error as Error)?.name, String((error as Error)?.message) + String((error as Error)?.stack).split("\n").slice(0, 3).join(" ")]);
    return undefined;
  }
  await readAll(rows, label, "app.ts", app.forms, names, given);
  await readAll(rows, label, "loose.js", app.loose?.forms, [...names, ...names.filter(name => stores && name in given).map(name => name + ", stored to")], given);
  await readAll(rows, label, "old.cjs", app.old?.forms, names, given);
  return app;
}
const argv = process.argv, exit = process.exit.bind(process), log = console.log.bind(console), isMainThread = Bun.isMainThread, post = postMessage;
async function main() {
  const rows: unknown[] = [];
  const wanted = argv[3] ? argv[3].split(",") : Object.keys(standIns);
  for (const name of wanted) await inGraph(rows, "one name", literally[name]?.(standIns[name]!()) ?? { [name]: standIns[name]!() }, [name, ...(name === "process" || name === "setTimeout" || name === "AbortSignal" || name === "Bun" || name === "Promise" ? ["built-in modules"] : [])]);
  for (const name of wanted) if (setToUndefined.includes(name)) await inGraph(rows, "undefined", literally[name]?.(undefined) ?? { [name]: undefined }, [name]);
  for (const name of ["globalThis", "global", "self"]) if (wanted.includes(name)) await inGraph(rows, "a plain object", { [name]: { mark: "plain", Bun: viewsBun, setTimeout: viewsSetTimeout, clearTimeout, Math: { floor: () => 41 }, Map: class extends Map { override get size() { return 41; } }, parseInt: () => 41, performance: { now: () => 41 }, onlyInView: 7 } }, [name]);
  if (!argv[3]) {
    const make = () => Object.fromEntries(hostNames.map(name => [name, ["postMessage", "onmessage", "addEventListener", "removeEventListener", "dispatchEvent", "close"].includes(name) ? undefined : standIns[name]!()]));
    const [givenA, givenB] = [make(), make()];
    const a = await inGraph(rows, "all of a host's, first graph", givenA, [...hostNames, "Math", "built-in modules"], false);
    const b = await inGraph(rows, "all of a host's, second graph", givenB, [...hostNames, "Math"], false);
    await inGraph(rows, "all of a host's, stored to", make(), hostNames);
    const none = await inGraph(rows, "no names", {}, [...hostNames, "Math", "JSON", "built-in modules"]);
    Object.assign(globalThis, real);
    const host = await import(url);
    await readAll(rows, "the host", "app.ts", host.forms, [...hostNames, "Math", "JSON", "built-in modules"], {});
    await readAll(rows, "the host", "loose.js", host.loose.forms, hostNames.filter(name => !["globalThis", "global", "self"].includes(name)).slice(0, 0), {});
    if (a && b && none) {
      await readAll(rows, "the first graph's, called by the second's code", "app.ts", a.forms, hostNames, givenA, b.callHere);
      await readAll(rows, "the first graph's, called by the host's code", "app.ts", a.forms, hostNames, givenA, host.callHere);
      await readAll(rows, "the host's, called by the first graph's code", "app.ts", host.forms, hostNames, {}, a.callHere);
      await readAll(rows, "no names, called by the first graph's code", "app.ts", none.forms, hostNames, {}, a.callHere);
    }
    rows.push(["", "", "", "stores through the views", written.join()]);
    rows.push(["", "", "", "what the views were asked for", Object.entries(Object.groupBy(asked.filter(key => key !== "Bun"), key => key)).map(([key, all]) => key + " " + all!.length).sort().join()]);
  }
  return rows;
}
if (isMainThread && argv[2] === "worker") {
  const worker = new Worker(import.meta.url, { argv: argv.slice(2) });
  worker.onmessage = (e: any) => { if (typeof e.data === "string") { log(e.data); exit(0); } };
} else {
  const result = JSON.stringify(await main());
  if (isMainThread) { log(result); exit(0); }
  else post(result);
}
`;

type Row = [graph: string, file: string, name: string, form: string, value: unknown];

// TODO: compiled code reads the global of the realm where a graph's `globals` name a stand-in.
test.todo(
  "a graph's `globals` replace existing globals as they do without --aot",
  async () => {
    using dir = tempDir("aot-module-graph-globals", {
      "entry.ts": entryText,
      "app.ts": moduleText(true),
      "loose.js": moduleText(false),
      "old.cjs": commonJSText(),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "esnext",
          moduleResolution: "bundler",
          strict: true,
          allowJs: true,
          skipLibCheck: true,
          typeRoots: [join(import.meta.dir, "..", "..", "packages")],
          types: ["bun-types"],
        },
      }),
    });
    const said: Record<string, Map<string, unknown>> = {};
    for (const flags of [[], ["--aot"]]) {
      mkdirSync(join(String(dir), "built" + flags.join("")));
      const executable = join(String(dir), "built" + flags.join(""), "out" + (isWindows ? ".exe" : ""));
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", ...flags, "--splitting", "entry.ts", "app.ts", "--outfile", executable],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
      for (const where of ["main", "worker"]) {
        const { stdout, stderr, exitCode } = await run([executable, where], String(dir));
        expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
        said[where + flags.join("")] = new Map(
          (JSON.parse(stdout) as Row[]).map(row => [row.slice(0, 4).join(" | "), row[4]]),
        );
      }
    }
    for (const where of ["main", "worker"]) {
      const [plain, compiled] = [said[where]!, said[where + "--aot"]!];
      expect(plain.size).toBeGreaterThan(10_000);
      // Not compared: undefined, NaN and Infinity, which a compiled program does not let a graph replace; Object and WeakMap, which the bundler's own
      // helpers use as free names, so that without --aot the bundle breaks itself; a real fetch() to a closed port, which fails sooner or later.
      // TODO(aot): how often the views are asked differs while an exception that leaves two graphs is caught with the wrong graph's state.
      const isCompared = (row: string) => {
        const [, , names, form] = row.split(" | ");
        const name = names!.split(",")[0]!;
        return (
          !["undefined", "NaN", "Infinity", "Object", "WeakMap"].includes(name) &&
          form !== "the file's forms" &&
          form !== "what the views were asked for" &&
          !(name === "fetch" && form === "call")
        );
      };
      expect(
        [...plain]
          .filter(([row, value]) => isCompared(row) && JSON.stringify(compiled.get(row)) !== JSON.stringify(value))
          .map(([row, value]) => ({ row, plain: value, compiled: compiled.get(row) })),
      ).toEqual([]);
    }
  },
  600_000,
);
