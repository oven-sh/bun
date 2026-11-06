// What the engine bed is asked before it is used. Its library is a stand-in: a built-in that is written in JavaScript answers
// undefined there, and which ones those are changes with the engine. Each probe is an expression and the pattern that finds its like
// in a program; a probe that answers differently compiled and plain puts its pattern on the list of what the bed does not allow.
const method = (name: string, expression: string): [string, string] => [`\\.${name}\\(`, expression];
const call = (name: string, expression: string): [string, string] => [`\\b${name.replace(".", "\\.")}\\(`, expression];

// prettier-ignore
export const probes: [pattern: string, expression: string][] = [
  method("map", "[1, 2].map(x => x)"), method("filter", "[1, 2].filter(x => x)"), method("forEach", "(() => { let s = 0; [1, 2].forEach(x => (s += x)); return s; })()"),
  method("reduce", "[1, 2].reduce((a, b) => a + b)"), method("reduceRight", "[1, 2].reduceRight((a, b) => a + b)"), method("some", "[1, 2].some(x => x)"), method("every", "[1, 2].every(x => x)"),
  method("find", "[1, 2].find(x => x)"), method("findIndex", "[1, 2].findIndex(x => x)"), method("findLast", "[1, 2].findLast(x => x)"), method("findLastIndex", "[1, 2].findLastIndex(x => x)"),
  method("includes", "[1, 2].includes(1)"), method("includes", "[].includes()"), method("includes", '"abc".includes("b")'), method("indexOf", "[1, 2].indexOf(2)"), method("indexOf", '["a", "b"].indexOf("b")'), method("indexOf", '"abc".indexOf("c")'),
  method("lastIndexOf", "[1, 2].lastIndexOf(2)"), method("join", "[1, 2].join()"), method("concat", "[1, 2].concat([3])"), method("slice", "[1, 2].slice(1)"), method("splice", "[1, 2].splice(0, 1)"),
  method("sort", "[2, 1].sort()"), method("sort", "[2, 1].sort((a, b) => a - b)"), method("reverse", "[1, 2].reverse()"), method("flat", "[1, [2]].flat()"), method("flatMap", "[1, 2].flatMap(x => [x])"),
  method("fill", "[1, 2].fill(0)"), method("copyWithin", "[1, 2].copyWithin(0, 1)"), method("at", "[1, 2].at(-1)"), method("push", "[1, 2].push(3)"), method("pop", "[1, 2].pop()"), method("shift", "[1, 2].shift()"), method("unshift", "[1, 2].unshift(0)"),
  ["(?<!Object)\\.keys\\(", "[...[1, 2].keys()]"], ["(?<!Object)\\.values\\(", "[...[1, 2].values()]"], ["(?<!Object)\\.entries\\(", "[...[1, 2].entries()]"], method("next", "[1, 2].values().next().value"), method("next", "(function* () { yield 1; })().next().value"),
  method("return", "(function* () { try { yield 1; } finally {} })().return(5).value"), method("throw", "(() => { try { (function* () { yield 1; })().throw(5); } catch (e) { return e; } })()"),
  method("toSorted", "[2, 1].toSorted()"), method("toSorted", "[2, 1].toSorted((a, b) => a - b)"), method("toReversed", "[1, 2].toReversed()"), method("toSpliced", "[1, 2].toSpliced(0, 1)"), method("with", "[1, 2].with(0, 5)"),
  call("Array.from", "Array.from([1, 2])"), call("Array.from", "Array.from({ length: 2 }, (_, i) => i)"), call("Array.of", "Array.of(1, 2)"), call("Array.isArray", "Array.isArray([])"),
  call("Object.keys", "Object.keys({ a: 1 })"), call("Object.values", "Object.values({ a: 1 })"), call("Object.entries", "Object.entries({ a: 1 })"), call("Object.assign", "Object.assign({}, { a: 1 }).a"), call("Object.fromEntries", 'Object.fromEntries([["a", 1]]).a'),
  call("Object.getOwnPropertyNames", "Object.getOwnPropertyNames({ a: 1 })"), call("Object.getOwnPropertySymbols", "Object.getOwnPropertySymbols({}).length"), call("Object.create", "Object.create({ a: 1 }).a"), call("Object.freeze", "Object.isFrozen(Object.freeze({ a: 1 }))"),
  call("Object.seal", "Object.isSealed(Object.seal({ a: 1 }))"), call("Object.preventExtensions", "Object.isExtensible(Object.preventExtensions({}))"), call("Object.getPrototypeOf", "Object.getPrototypeOf([]) === Array.prototype"), call("Object.setPrototypeOf", "Object.setPrototypeOf({}, { a: 1 }).a"),
  call("Object.defineProperty", 'Object.defineProperty({}, "a", { value: 1 }).a'), call("Object.defineProperties", "Object.defineProperties({}, { a: { value: 1 } }).a"), call("Object.getOwnPropertyDescriptor", 'Object.getOwnPropertyDescriptor({ a: 1 }, "a").value'),
  call("Object.getOwnPropertyDescriptors", "Object.getOwnPropertyDescriptors({ a: 1 }).a.value"), call("Object.hasOwn", 'Object.hasOwn({ a: 1 }, "a")'), call("Object.is", "Object.is(-0, 0)"), call("Object.groupBy", 'Object.groupBy([1, 2], x => (x % 2 ? "o" : "e")).o'),
  method("hasOwnProperty", '({ a: 1 }).hasOwnProperty("a")'), method("propertyIsEnumerable", '({ a: 1 }).propertyIsEnumerable("a")'), method("isPrototypeOf", "Array.prototype.isPrototypeOf([])"),
  call("Reflect.ownKeys", "Reflect.ownKeys({ a: 1 })"), call("Reflect.get", 'Reflect.get({ a: 1 }, "a")'), call("Reflect.set", 'Reflect.set({}, "a", 1)'), call("Reflect.has", 'Reflect.has({ a: 1 }, "a")'), call("Reflect.apply", "Reflect.apply(Math.max, null, [1, 2])"),
  call("Reflect.construct", "Reflect.construct(Array, [1, 2])"), call("Reflect.getPrototypeOf", "Reflect.getPrototypeOf({}) === Object.prototype"), call("Reflect.setPrototypeOf", "Reflect.setPrototypeOf({}, null)"), call("Reflect.defineProperty", 'Reflect.defineProperty({}, "a", { value: 1 })'),
  call("Reflect.deleteProperty", 'Reflect.deleteProperty({ a: 1 }, "a")'), call("Reflect.getOwnPropertyDescriptor", 'Reflect.getOwnPropertyDescriptor({ a: 1 }, "a").value'), call("Reflect.isExtensible", "Reflect.isExtensible({})"), call("Reflect.preventExtensions", "Reflect.preventExtensions({})"),
  call("JSON.stringify", 'JSON.stringify({ a: [1, "x"] })'), call("JSON.stringify", "JSON.stringify({ a: 1 }, (k, v) => v)"), call("JSON.stringify", "JSON.stringify({ toJSON() { return 3; } })"), call("JSON.parse", "JSON.parse('{\"a\":1}').a"), call("JSON.parse", "JSON.parse('{\"a\":1}', (k, v) => v).a"),
  method("replace", '"abc".replace("b", "x")'), method("replace", '"abc".replace("b", () => "x")'), method("replace", '"abc".replace(/b/g, m => m + m)'), method("replaceAll", '"abab".replaceAll("a", "x")'), method("split", '"a,b".split(",")'), method("split", '"a,b".split(/,/)'),
  method("match", '"abc".match(/b/)[0]'), method("matchAll", '[..."abab".matchAll(/a/g)].length'), method("search", '"abc".search(/c/)'), method("substring", '"abc".substring(1)'), method("charAt", '"abc".charAt(1)'), method("charCodeAt", '"abc".charCodeAt(1)'),
  method("codePointAt", '"abc".codePointAt(1)'), method("startsWith", '"abc".startsWith("a")'), method("endsWith", '"abc".endsWith("c")'), method("toUpperCase", '"abc".toUpperCase()'), method("toLowerCase", '"ABC".toLowerCase()'), method("trim", '" a ".trim()'),
  method("padStart", '"a".padStart(3)'), method("padEnd", '"a".padEnd(3, "x")'), method("repeat", '"a".repeat(3)'), method("normalize", '"abc".normalize()'), call("String.fromCharCode", "String.fromCharCode(65)"), call("String.fromCodePoint", "String.fromCodePoint(65)"), ["\\bString\\.raw`", "String.raw`a${1}`"],
  method("test", '/a/.test("a")'), method("exec", '/a/.exec("a")[0]'),
  method("get", "new Map([[1, 2]]).get(1)"), method("set", "new Map().set(1, 2).has(1)"), method("has", "new Set([1]).has(1)"), method("delete", "new Map([[1, 2]]).delete(1)"), method("add", "new Set().add(1).size"), method("clear", "(() => { const m = new Map([[1, 2]]); m.clear(); return m.size; })()"),
  method("forEach", "(() => { let s = 0; new Map([[1, 2]]).forEach(v => (s += v)); return s; })()"), method("forEach", "(() => { let s = 0; new Set([1, 2]).forEach(v => (s += v)); return s; })()"),
  ["\\[\\.\\.\\.(?!\\[)", "[...new Map([[1, 2]])]"], ["\\[\\.\\.\\.(?!\\[)", "[...new Set([1, 2])]"], ["\\[\\.\\.\\.(?!\\[)", "(function () { return [...arguments]; })(1, 2)"], ["\\[\\.\\.\\.(?!\\[)", '[..."ab"]'], ["\\[\\.\\.\\.(?!\\[)", "[...(function* () { yield 1; })()]"], ["\\[\\.\\.\\.(?!\\[)", "(list => [...list])([1, 2])"],
  ["\\[\\.\\.\\.\\[", "[...[1, 2]]"], ["\\(\\.\\.\\.", "Math.max(...[1, 2])"], ["\\{ ?\\.\\.\\.", "({ ...{ a: 1 } }).a"],
  ["\\bof new Map\\b|\\bconst \\[\\w+, \\w+\\] of\\b", "(() => { let s = 0; for (const [k, v] of new Map([[1, 2]])) s += k + v; return s; })()"],
  method("union", "new Set([1, 2]).union(new Set([3])).size"), call("Map.groupBy", "Map.groupBy([1, 2], x => x % 2).get(1)"),
  method("call", "(function () { return this; }).call(5)"), method("call", "(function (a) { return a; }).call(null, 5)"), method("apply", "(function (a) { return a; }).apply(null, [1])"), method("bind", "(function (a, b) { return a + b; }).bind(null, 1)(2)"),
  ["\\bnew Function\\b", 'new Function("return 1")()'], ["\\beval\\(", 'eval("1 + 1")'], ["\\bnew Proxy\\b", "new Proxy({ a: 1 }, {}).a"], ["\\bnew Proxy\\b", "new Proxy({}, { get: () => 5 }).x"], ["\\bnew Proxy\\b", "new Proxy(function () { return 1; }, {})()"],
  ["\\bUint8Array\\b", "new Uint8Array([1, 2])[1]"], ["\\bFloat64Array\\b", "new Float64Array([1.5])[0]"], ["\\bInt32Array\\b", "new Int32Array(2).length"], method("subarray", "new Uint8Array([1, 2]).subarray(1)[0]"), call("Uint8Array.from", "Uint8Array.from([1, 2])[1]"),
  ["\\bfunction\\*|\\*\\w*\\(|\\byield\\b", "(() => { let s = 0; for (const v of (function* () { yield 1; yield 2; })()) s += v; return s; })()"], ["\\byield\\*", "(() => { let s = 0; for (const v of (function* () { yield* [1, 2]; })()) s += v; return s; })()"],
  method("toArray", "[1, 2].values().map(x => x * 2).toArray()"), call("Iterator.from", "Iterator.from([1, 2]).toArray()"),
  ["\\bextends Array\\b", "(() => { class A extends Array {} return new A(1, 2).length; })()"], ["\\bextends Map\\b", "(() => { class A extends Map {} return new A([[1, 2]]).get(1); })()"], ["\\bextends Set\\b", "(() => { class A extends Set {} return new A([1]).size; })()"],
  ["\\bextends \\w*Error\\b", '(() => { class A extends Error {} return new A("m").message; })()'], ["\\bextends Promise\\b", "(() => { class A extends Promise {} return A.resolve(1) instanceof A; })()"],
  ["\\bconst \\[|\\blet \\[|\\(\\[", "(() => { const [a, b] = [1, 2]; return a + b; })()"], ["\\.\\.\\.\\w+\\] =", "(() => { const [a, ...b] = [1, 2, 3]; return b; })()"], ["\\.\\.\\.\\w+ \\} =", "(() => { const { a, ...b } = { a: 1, c: 2 }; return Object.keys(b); })()"],
  ["\\bfor \\(\\w+ \\w+ in\\b", '(() => { let s = ""; for (const k in { a: 1, b: 2 }) s += k; return s; })()'], ["\\bSymbol\\.for\\(", 'Symbol.for("a") === Symbol.for("a")'], ["\\bnew Date\\b", "new Date(0).toISOString()"], ["\\bnew WeakMap\\b", "(() => { const k = {}; return new WeakMap([[k, 1]]).get(k); })()"],
  ["\\bnew WeakSet\\b", "(() => { const k = {}; return new WeakSet([k]).has(k); })()"], ["\\bnew WeakRef\\b", "new WeakRef({}).deref() !== undefined"], ["#\\w+", "(() => { class A { #x = 1; get x() { return this.#x; } #m() { return 2; } n() { return this.#m(); } } return new A().x + new A().n(); })()"],
  ["\\bstatic \\{", "(class { static y; static { this.y = 2; } }).y"], ["\\d+n\\b|\\bBigInt\\b", "1n + BigInt(2)"], method("toFixed", "(1.5).toFixed(1)"), method("toString", "(255).toString(16)"), method("toString", "[1, 2].toString()"), method("toString", "({}).toString()"),
  ["\\w`", "((s, ...v) => s.raw[0] + v[0])`a${1}`"], ["\\bnew\\.target\\b", "(function F() { return new.target === F; }, new (function F() { this.t = new.target !== undefined; })().t)"], ["\\bsuper\\b", "(() => { class A { m() { return 1; } } class B extends A { m() { return super.m() + 1; } } return new B().m(); })()"],
  ["\\bget \\w+\\(|\\bset \\w+\\(", "(() => { const o = { v: 1, get a() { return this.v; }, set a(x) { this.v = x; } }; o.a = 5; return o.a; })()"], ["\\bSymbol\\.toPrimitive\\b", "+{ [Symbol.toPrimitive]() { return 3; } }"], ["\\bSymbol\\.iterator\\b", "(() => { let s = 0; for (const v of { [Symbol.iterator]() { let i = 0; return { next: () => ({ done: i >= 2, value: i++ }) }; } }) s += v; return s; })()"],
  ["\\bSymbol\\.hasInstance\\b", "1 instanceof { [Symbol.hasInstance]: () => true }"], ["\\bSymbol\\.species\\b", "(() => { const a = [1, 2]; a.constructor = { [Symbol.species]: function (n) { return { length: n, made: true }; } }; return a.slice(0).made; })()"],
  ["\\bSymbol\\.isConcatSpreadable\\b", "[].concat({ length: 1, 0: 5, [Symbol.isConcatSpreadable]: true })"], ["\\bSymbol\\.toStringTag\\b", 'String({ [Symbol.toStringTag]: "T" })'], ["\\bSuppressedError\\b", "new SuppressedError(1, 2).error"], ["\\bAggregateError\\b", 'new AggregateError([1], "m").errors.length'],
];

// Each prints later, so each is a statement that reports by itself.
// prettier-ignore
export const laterProbes: [pattern: string, statement: string][] = [
  ["\\.then\\(", 'Promise.resolve(1).then(v => report("then " + v))'], ["\\.catch\\(", 'Promise.reject(1).catch(v => report("catch " + v))'], ["\\.finally\\(", 'Promise.resolve(1).finally(() => report("finally"))'],
  ["\\bPromise\\.all\\(", '(async () => report("all " + (await Promise.all([1, Promise.resolve(2)]))))()'], ["\\bPromise\\.allSettled\\(", '(async () => report("allSettled " + (await Promise.allSettled([1])).length))()'], ["\\bPromise\\.race\\(", '(async () => report("race " + (await Promise.race([1]))))()'],
  ["\\bPromise\\.any\\(", '(async () => report("any " + (await Promise.any([1]))))()'], ["\\bnew Promise\\b", '(async () => report("new " + (await new Promise(resolve => resolve(1)))))()'], ["\\bPromise\\.resolve\\(", '(async () => report("resolve " + (await Promise.resolve(1))))()'],
  ["\\bPromise\\.reject\\(", '(async () => { try { await Promise.reject(new Error("x")); } catch (e) { report("rejected " + e.message); } })()'], ["\\basync\\b|\\bawait\\b", '(async () => { await null; report("await"); })()'], ["\\bthen\\(", '(async () => report("thenable " + (await { then(resolve) { resolve(1); } })))()'],
  ["\\bfor await\\b", '(async () => { for await (const v of [1, 2]) report("for await " + v); })()'], ["\\basync function\\*|\\basync \\*", '(async () => { async function* g() { yield 1; } for await (const v of g()) report("async generator " + v); })()'], ["\\bPromise\\.withResolvers\\(", '(async () => { const { promise, resolve } = Promise.withResolvers(); resolve(1); report("withResolvers " + (await promise)); })()'],
];

/** A program that asks the probes with the given numbers (the later probes count on from the others): each answers with a line that starts with its number. */
export function probeProgram(numbers: number[]): string {
  let text = `function text(v) { if (typeof v === "symbol") return "symbol"; if (typeof v === "bigint") return v + "n"; if (typeof v === "object" && v !== null) { try { return JSON.stringify(v); } catch (e) { return "object"; } } return String(v); }\n`;
  for (const number of numbers) {
    if (number < probes.length) text += `try { print("${number} " + text(${probes[number][1]})); } catch (e) { print("${number} threw " + e); }\n`;
    else text += `{ const report = said => print("${number} " + said); try { ${laterProbes[number - probes.length][1]}; } catch (e) { report("threw " + e); } }\n`;
  }
  return text;
}
