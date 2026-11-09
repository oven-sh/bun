// `const first = a[0]; something(); return first + a[0];`: a compiler that remembers the first read has to know that `something` writes nothing
// there. Much can write a place without being a store to it: a host function that fills what it is given, a second view over the same bytes,
// a buffer that is handed away or resized, a built-in that looks pure and converts an operand by the program's own `valueOf`, `toString` or
// getter, a host object's own method. And a store may only be dropped in front of a second one if nothing read the place between the two: a
// host function can.
// Each function reads or stores one place twice: an element, a length, a field, what a host object's getter or method answers. Between the
// two stands one such writer or reader. What is asked is local to a function.
import type { Random } from "./random";

// The program's own code, run by something that looks as if it ran none. `E` is the effect.
const runsCode = (E: string): string[] => [
  `Math.max({ valueOf() { ${E}; return 0; } })`, `Math.abs({ valueOf() { ${E}; return 0; } })`, `Math.floor({ valueOf() { ${E}; return 0; } })`, `isNaN({ valueOf() { ${E}; return 0; } })`, `Number({ valueOf() { ${E}; return 0; } })`,
  `String({ toString() { ${E}; return ""; } })`, `\`\${{ toString() { ${E}; return ""; } }}\``, `+{ valueOf() { ${E}; return 0; } }`, `"".padEnd({ valueOf() { ${E}; return 0; } })`, `"abc".charAt({ valueOf() { ${E}; return 0; } })`, `"abc".slice({ valueOf() { ${E}; return 0; } })`,
  `"abc".indexOf({ toString() { ${E}; return "b"; } })`, `parseInt({ toString() { ${E}; return "1"; } })`, `({})[{ toString() { ${E}; return "k"; } }]`, `({ get k() { ${E}; return 1; } }).k`, `({ set k(v) { ${E}; } }).k = 1`,
  `Object.keys(new Proxy({}, { ownKeys() { ${E}; return []; } }))`, `new Proxy({}, { get() { ${E}; } }).k`, `"k" in new Proxy({}, { has() { ${E}; return false; } })`, `JSON.stringify({ toJSON() { ${E}; } })`, `JSON.stringify({ get k() { ${E}; return 1; } })`, `JSON.parse("0", () => { ${E}; })`,
  `[2, 1].sort(() => { ${E}; return 0; })`, `Array.from({ length: 1 }, () => { ${E}; })`, `Array.from({ get length() { ${E}; return 0; } })`, `new Set([1]).forEach(() => { ${E}; })`, `new Map([[1, 1]]).forEach(() => { ${E}; })`, `"x".replace("x", () => { ${E}; return ""; })`, `"x".replace(/x/, () => { ${E}; return ""; })`,
  `[...{ *[Symbol.iterator]() { ${E}; } }]`, `(([]) => 0)({ *[Symbol.iterator]() { ${E}; } })`, `({}) instanceof ({ [Symbol.hasInstance]() { ${E}; return false; } })`, `new (class { constructor() { ${E}; } })()`, `Reflect.construct(function () { ${E}; }, [])`, `Reflect.apply(() => { ${E}; }, null, [])`,
  `structuredClone({ get k() { ${E}; return 1; } })`, `Object.assign({}, { get k() { ${E}; return 1; } })`, `({ ...{ get k() { ${E}; return 1; } } })`, `Object.values({ get k() { ${E}; return 1; } })`, `Object.entries({ get k() { ${E}; return 1; } })`, `new Error({ toString() { ${E}; return ""; } })`, `new Date({ valueOf() { ${E}; return 0; } })`,
  `Symbol({ toString() { ${E}; return ""; } })`, `encodeURIComponent({ toString() { ${E}; return ""; } })`, `new RegExp({ toString() { ${E}; return "a"; } })`, `/a/.test({ toString() { ${E}; return "a"; } })`, `BigInt({ valueOf() { ${E}; return 1; } })`, `[].concat({ get [Symbol.isConcatSpreadable]() { ${E}; return false; } })`,
  `Promise.resolve({ get then() { ${E}; } })`, `new Intl.NumberFormat("en", { get style() { ${E}; } })`, `new Response("", { get status() { ${E}; return 200; } })`, `new Event("e", { get bubbles() { ${E}; return false; } })`, `new Error("m", { get cause() { ${E}; } })`,
  `(() => { const t = new EventTarget(); t.addEventListener("e", () => { ${E}; }); t.dispatchEvent(new Event("e")); })()`, `[0].at({ valueOf() { ${E}; return 0; } })`, `[0].indexOf(0, { valueOf() { ${E}; return 0; } })`, `[0].join({ toString() { ${E}; return ","; } })`, `[{ toString() { ${E}; return ""; } }].join()`,
  `1 < { valueOf() { ${E}; return 0; } }`, `1 == { valueOf() { ${E}; return 0; } }`, `1 - { valueOf() { ${E}; return 0; } }`, `"" + { valueOf() { ${E}; return 0; } }`, `({ [{ toString() { ${E}; return "k"; } }]: 1 })`, `((p = (${E})) => 0)()`, `(t => 0)\`\${(${E})}\``, `new Uint8Array({ get length() { ${E}; return 0; } })`,
  `new Uint8Array(1).fill({ valueOf() { ${E}; return 0; } })`, `new Uint8Array(1).set([{ valueOf() { ${E}; return 0; } }])`, `new Uint8Array(1)[0] = { valueOf() { ${E}; return 0; } }`, `Object.defineProperty({}, "k", { get value() { ${E}; return 1; } })`, `Object.create(null, { k: { get value() { ${E}; return 1; } } })`,
  `Object.fromEntries([[{ toString() { ${E}; return "k"; } }, 1]])`, `Object.hasOwn({}, { toString() { ${E}; return "k"; } })`, `Reflect.has({}, { toString() { ${E}; return "k"; } })`, `String.fromCharCode({ valueOf() { ${E}; return 65; } })`, `"a".localeCompare({ toString() { ${E}; return "a"; } })`, `"a".repeat({ valueOf() { ${E}; return 1; } })`,
  `Buffer.from({ valueOf() { ${E}; return "a"; } })`, `Buffer.alloc(1).fill({ valueOf() { ${E}; return 0; } })`, `new URL({ toString() { ${E}; return "http://a.test/"; } })`, `new Headers({ get a() { ${E}; return "b"; } })`, `new URLSearchParams({ get a() { ${E}; return "b"; } })`, `new TextDecoder({ toString() { ${E}; return "utf-8"; } })`,
  `Bun.inspect({ [Bun.inspect.custom]() { ${E}; return ""; } })`, `Bun.deepEquals({ get k() { ${E}; return 1; } }, { k: 1 })`, `new Blob([{ toString() { ${E}; return ""; } }])`, `btoa({ toString() { ${E}; return ""; } })`, `Bun.escapeHTML({ toString() { ${E}; return ""; } })`, `Bun.stringWidth({ toString() { ${E}; return ""; } })`,
];

type Observers = Record<string, (W: string) => string>;
type Row = { make: string; observe: (W: string) => string; writer: string; head: string };
const rows: Row[] = [];
const kind = (make: string, observers: Observers, writers: string[], head = "") => {
  for (const observe of Object.values(observers)) for (const writer of writers) rows.push({ make, observe, writer, head });
};

const elements: Observers = {
  "read, written, read": (W: string) => `const first = a[0]; ${W}; return first + " " + a[0];`,
  "read in every turn": (W: string) => `let sum = ""; for (let i = 0; i < 3; i++) { sum += a[0] + " "; ${W}; } return sum;`,
  "its length, twice": (W: string) => `const n = a.length; ${W}; return n + " " + a.length;`,
  "stored, written, read": (W: string) => `a[0] = 5; ${W}; return a[0];`,
  "walked to its length": (W: string) => `let sum = ""; for (let i = 0; i < a.length; i++) { sum += a[i] + " "; if (i === 0) { ${W}; } } return sum;`,
  "stored twice": (W: string) => `a[0] = 5; ${W}; a[0] = 6; return a[0] + " " + told.splice(0).join();`,
};
const bytes = [
  "a.fill(9)", "a.set([9])", "a.copyWithin(0, 1)", "a.reverse()", "a.sort((p, q) => q - p)", "Array.prototype.fill.call(a, 9)", "Array.prototype.reverse.call(a)", "Array.prototype.sort.call(a, (p, q) => q - p)", "Array.prototype.copyWithin.call(a, 0, 1)", "Reflect.apply(a.fill, a, [9])", "a.fill.bind(a)(9)",
  "new Uint8Array(a.buffer)[0] = 9", "new Uint8Array(a.buffer).fill(9)", "a.subarray(0).fill(9)", "a.subarray(0)[0] = 9", "new DataView(a.buffer).setUint8(0, 9)", "Buffer.from(a.buffer).fill(9)", "Buffer.from(a.buffer).writeUInt8(9, 0)", "Buffer.from(a.buffer)[0] = 9", "Buffer.from([9]).copy(Buffer.from(a.buffer))", "Buffer.from([9, 9, 9, 9, 9, 9, 9, 9]).copy(a)",
  "new Float32Array(a.buffer)[0] = 9", "new Int16Array(a.buffer).fill(9)", "new BigInt64Array(new Uint8Array(a.buffer).length >= 8 ? a.buffer : new ArrayBuffer(8))[0] = 9n",
  "Atomics.store(a, 0, 9)", "Atomics.add(a, 0, 9)", "Atomics.exchange(a, 0, 9)", "Atomics.compareExchange(a, 0, 1, 9)", "Atomics.or(a, 0, 8)", "Atomics.xor(a, 0, 8)", "Atomics.sub(a, 0, 1)", "Atomics.and(a, 0, 0)",
  `new TextEncoder().encodeInto("z", a)`, "Reflect.set(a, 0, 9)", "Object.assign(a, [9])", "Object.assign(a, { 0: 9 })", "Object.defineProperty(a, 0, { value: 9 })", "Reflect.defineProperty(a, 0, { value: 9 })", `a[JSON.parse("0")] = 9`, `a["0"] = 9`, "[a[0]] = [9]", "({ k: a[0] } = { k: 9 })", "for (a[0] of [9]);",
  "structuredClone(a, { transfer: [a.buffer] })", "a.buffer.transfer()", "a.buffer.transferToFixedLength()", "a.buffer.resize(1)", "a.buffer.resize(8)", "a.buffer.resize(0)", "new MessageChannel().port1.postMessage(null, [a.buffer])",
  "a.forEach((v, i, all) => { all[0] = 9; })", "a.map((v, i, all) => (all[0] = 9))", "a.find((v, i, all) => { all[0] = 9; })", "a.some((v, i, all) => { all[0] = 9; })", "a.reduce((s, v, i, all) => { all[0] = 9; return s; }, 0)",
  "a.at({ valueOf() { a[0] = 9; return 0; } })", "a.indexOf(0, { valueOf() { a[0] = 9; return 0; } })", "a.slice({ valueOf() { a[0] = 9; return 0; } })", `a.join({ toString() { a[0] = 9; return ","; } })`, "a.includes(0, { valueOf() { a[0] = 9; return 0; } })", "a.subarray({ valueOf() { a[0] = 9; return 0; } })",
  "a.at({ valueOf() { a.buffer.transfer(); return 0; } })", "a.fill({ valueOf() { a.buffer.transfer(); return 9; } })", "a[1] = { valueOf() { a[0] = 9; return 0; } }", "a[1] = { valueOf() { a.buffer.transfer(); return 0; } }", "a.set([{ valueOf() { a.buffer.transfer(); return 0; } }])",
];
// What reads the bytes between two stores: the first store may not be dropped.
const readers = ["a.join()", `Buffer.from(a.buffer).toString("hex")`, "new Uint8Array(a.buffer)[0]", "new DataView(a.buffer).getUint8(0)", "Bun.hash(a)", "Array.from(a)[0]", "a.slice()[0]", "[...a][0]", "Math.max(...a)", "String(a)", "a.indexOf(5)", "a.includes(5)", "a.at(0)", "JSON.stringify(a)", "Bun.inspect(a)", "structuredClone(a)[0]", "a.subarray(0)[0]", "Array.prototype.slice.call(a)[0]", "Reflect.get(a, 0)", "Object.getOwnPropertyDescriptor(a, 0).value", "Object.values(a)[0]", "Object.entries(a)[0][1]", "a.toString()", "a.reduce((s, v) => s + v, 0)", "a.find(v => v === 5)", "Object.assign({}, a)[0]", "({ ...a })[0]", "a.lastIndexOf(5)", "a.findLast(v => v === 5)", "a.toReversed().at(-1)", "a.with(1, 0)[0]", "a.values().next().value", "a.entries().next().value[1]", "Bun.deepEquals(a, a.slice())"];

const views = { "Uint8Array": "new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])", "Int32Array": "new Int32Array([1, 2, 3, 4])", "Float64Array": "new Float64Array([1.5, 2.5, 3.5, 4.5])", "Buffer": "Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])", "a view that follows its buffer": "(() => { const v = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 })); v.set([1, 2, 3, 4]); return v; })()" };
const { "stored twice": storedTwice, ...written } = elements;
for (const [name, make] of Object.entries(views)) {
  kind(make, written, [...bytes, ...(name === "Uint8Array" || name === "Float64Array" ? runsCode("a[0] = 9") : []), ...(name === "Uint8Array" ? runsCode("a.buffer.transfer()") : [])]);
  kind(make, { storedTwice }, readers.map(r => `told.push(${r})`));
}
const lists = [
  "a.fill(9)", "a.reverse()", "a.sort((p, q) => (p < q ? 1 : -1))", "a.copyWithin(0, 1)", "a.splice(0, 1)", "a.shift()", "a.unshift(9)", "a.pop()", "a.push(9)", "Array.prototype.fill.call(a, 9)", "Array.prototype.push.call(a, 9)", "Array.prototype.shift.call(a)", "Array.prototype.splice.call(a, 0, 1)", "Reflect.apply(a.fill, a, [9])", "a.fill.bind(a)(9)", "[].pop.apply(a)",
  "a.length = 0", "a.length = 1", `Reflect.set(a, "length", 0)`, `Object.defineProperty(a, "length", { value: 0 })`, `a[JSON.parse('"length"')] = 0`, "delete a[0]", "Reflect.deleteProperty(a, 0)", "Object.assign(a, [9])", "Object.assign(a, { 0: 9 })", "Reflect.set(a, 0, 9)", "Reflect.set([], 0, 9, a)", "Object.defineProperty(a, 0, { value: 9 })", "Object.defineProperty(a, 0, { get() { return 9; } })", "Object.defineProperties(a, { 0: { value: 9 } })",
  "Object.freeze(a)", "Object.seal(a)", "Object.preventExtensions(a)", "a[10] = 9", "a[1000000] = 9", `a[0] = "text"`, `a.fill("text")`, "a.fill(1.5)", "a.fill({})", "a.fill(undefined)", `a.splice(0, 1, "text")`, "a.splice(0, 1, 1.5)", `a[JSON.parse("0")] = 9`, `a["0"] = 9`, "[a[0]] = [9]", "({ k: a[0] } = { k: 9 })", "for (a[0] of [9]);", "[a[0], a[1]] = [a[1], a[0]]",
  "a.forEach((v, i, all) => { all[0] = 9; })", "a.map((v, i, all) => (all[0] = 9))", "a.find((v, i, all) => { all[0] = 9; })", "a.some((v, i, all) => { all.length = 0; })", "a.reduce((s, v, i, all) => { all[0] = 9; return s; }, 0)", "a.at({ valueOf() { a[0] = 9; return 0; } })", "a.indexOf(0, { valueOf() { a.length = 0; return 0; } })", "a.slice({ valueOf() { a[0] = 9; return 0; } })", `a.join({ toString() { a[0] = 9; return ","; } })`, "a.includes(0, { valueOf() { a[0] = 9; return 0; } })",
  `JSON.stringify(a, function (k, v) { if (k === "1") this[0] = 9; return v; })`, "Object.setPrototypeOf(a, { 0: 9 }), delete a[0]", "new Proxy(a, {})[0] = 9", "new Proxy(a, {}).length = 0", "a.concat({ get [Symbol.isConcatSpreadable]() { a[0] = 9; return false; } })", "a.flat({ valueOf() { a[0] = 9; return 1; } })", "a.with({ valueOf() { a[0] = 9; return 1; } }, 0)", "a.toSpliced({ valueOf() { a[0] = 9; return 0; } }, 0)",
];
for (const [name, make] of Object.entries({ "a list of integers": "[1, 2, 3, 4]", "a list of fractions": "[1.5, 2.5, 3.5, 4.5]", "a list of texts": `["p", "q", "r", "s"]`, "a list with a hole": "[1, , 3, 4]" })) {
  kind(make, written, [...lists, ...(name === "a list of integers" ? [...runsCode("a[0] = 9"), ...runsCode("a.length = 0"), ...runsCode(`a[0] = "text"`)] : [])]);
  kind(make, { storedTwice }, readers.filter(r => !r.includes("buffer") && !r.includes("subarray") && !r.includes("Bun.hash")).map(r => `told.push(${r})`));
}
const fields: Observers = {
  "read, written, read": (W: string) => `const first = a.x; ${W}; return first + " " + a.x;`,
  "read in every turn": (W: string) => `let sum = ""; for (let i = 0; i < 3; i++) { sum += a.x + " "; ${W}; } return sum;`,
  "stored, written, read": (W: string) => `a.x = 5; ${W}; return a.x;`,
  "asked for, twice": (W: string) => `const had = "x" in a; ${W}; return had + " " + ("x" in a) + " " + Object.keys(a).length;`,
};
const members = [
  "Object.assign(a, { x: 9 })", `Object.assign(a, JSON.parse('{"x":9}'))`, `Reflect.set(a, "x", 9)`, `Reflect.set({}, "x", 9, a)`, `Object.defineProperty(a, "x", { value: 9 })`, `Object.defineProperty(a, "x", { get() { return 9; } })`, "Object.defineProperties(a, { x: { value: 9 } })", "Object.defineProperties(a, Object.getOwnPropertyDescriptors({ x: 9 }))", "delete a.x", `Reflect.deleteProperty(a, "x")`, `delete a[JSON.parse('"x"')]`,
  "({ x: a.x } = { x: 9 })", "[a.x] = [9]", "for (a.x of [9]);", `for (a.x in { nine: 1 });`, `a.__defineGetter__("x", () => 9)`, `a[JSON.parse('"x"')] = 9`, "new Proxy(a, {}).x = 9", "Object.freeze(a)", "Object.seal(a)", `Object.defineProperty(a, "x", { writable: false })`, "Object.entries({ x: 9 }).forEach(([k, v]) => { a[k] = v; })", "for (const k in { x: 0 }) a[k] = 9",
  `JSON.stringify(a, function (k, v) { if (k === "y") this.x = 9; return v; })`, "Object.setPrototypeOf(a, { x: 9 }), delete a.x", "({ __proto__: a, put() { super.x = 9; } }).put.call(a)", `Object.assign(a, { x: "text" })`, `Reflect.set(a, "x", "text")`, `Object.defineProperty(a, "x", { value: 1.5 })`, "Object.assign(a, { x: undefined })", "Object.assign(a, { get x() { return 9; } })", "Object.assign(a, new Map([[1, 2]]), [0], { x: 9 })",
];
const fieldReaders = ["JSON.stringify(a)", "structuredClone(a).x", "Object.values(a).join()", "Bun.inspect(a)", "Object.assign({}, a).x", "({ ...a }).x", `Reflect.get(a, "x")`, `Object.getOwnPropertyDescriptor(a, "x").value`, "Object.entries(a)[0][1]", "Bun.deepEquals(a, { x: 5, y: 2 })", `a[JSON.parse('"x"')]`, "new Proxy(a, {}).x", "Object.create(a).x", "(({ x }) => x)(a)", "Object.getOwnPropertyDescriptors(a).x.value", "Object.fromEntries(Object.entries(a)).x", `(() => { for (const k in a) return a[k]; })()`];
for (const [name, head, make] of [["a literal", "", "{ x: 1, y: 2 }"], ["an instance", "class P { constructor() { this.x = 1; this.y = 2; } }\n", "new P()"], ["an instance with fields", "class P { x = 1; y = 2; }\n", "new P()"], ["an ES5 instance", "function P() { this.x = 1; this.y = 2; }\n", "new P()"]]) {
  kind(make, fields, [...members, ...(name === "an instance" ? [...runsCode("a.x = 9"), ...runsCode(`a.x = "text"`), ...runsCode("delete a.x")] : [])], head);
  kind(make, { "stored twice": (W: string) => `a.x = 5; ${W}; a.x = 6; return a.x + " " + told.splice(0).join();` }, fieldReaders.map(r => `told.push(${r})`), head);
}
// Host objects: what one of their own getters or methods answers, around one of their own mutators.
const twice = (make: string, reads: string[], writers: string[], head = "") =>
  kind(make, Object.fromEntries(reads.flatMap(r => [[`${r}, twice`, (W: string) => `const first = ${r}; ${W}; return first + " " + ${r};`], [`${r}, in every turn`, (W: string) => `let sum = ""; for (let i = 0; i < 3; i++) { sum += ${r} + " "; ${W}; } return sum;`]])), writers, head);
twice("new Map([[1, 2]])", ["a.size", "a.get(1)", "a.has(1)", "a.has(5)"], ["a.set(1, 9)", "a.set(5, 9)", "Map.prototype.set.call(a, 5, 9)", "a.clear()", "a.delete(1)", "Reflect.apply(Map.prototype.clear, a, [])", "a.forEach((v, k, all) => all.delete(k))", "a.set.bind(a)(5, 9)", ...runsCode("a.set(5, 9)").slice(0, 24), ...runsCode("a.clear()").slice(0, 24)]);
twice("new Set([1])", ["a.size", "a.has(1)", "a.has(5)"], ["a.add(5)", "Set.prototype.add.call(a, 5)", "a.clear()", "a.delete(1)", "a.forEach((v, k, all) => all.delete(k))", ...runsCode("a.add(5)").slice(0, 24)]);
twice("/a/g", ["a.lastIndex"], [`a.test("aa")`, `a.exec("aa")`, `"aa".match(a)`, `"aa".replace(a, "")`, `"aa".search(a)`, `"aa".split(a)`, `[..."aa".matchAll(a)]`, `RegExp.prototype.test.call(a, "aa")`, `Reflect.set(a, "lastIndex", 1)`, `a.compile("b")`, `a[Symbol.match]("aa")`, `a[Symbol.replace]("aa", "")`, `"aa".replaceAll(a, "")`]);
twice("/a/y", ["a.lastIndex", `a.test("aa")`], [`a.test("aa")`, `a.exec("aa")`, `"aa".match(a)`, `"aa".replace(a, "")`, `"aa".search(a)`, `"aa".split(a)`, "a.lastIndex = 1"]);
twice("new Date(0)", ["a.getTime()", "a.valueOf()", "+a", "a.getUTCFullYear()", "a.toISOString()"], ["a.setTime(9)", "Date.prototype.setTime.call(a, 9)", "a.setUTCFullYear(2000)", "a.setMilliseconds(5)", "Reflect.apply(a.setTime, a, [9])", "a.setTime(NaN)", "a.setTime({ valueOf() { return 9; } })"]);
twice(`new URL("http://a.test/p?q=1")`, ["a.href", "a.search", "a.searchParams.size", "String(a)", `a.searchParams.get("q")`], [`a.searchParams.set("q", "9")`, `a.searchParams.append("r", "9")`, `a.searchParams.delete("q")`, `a.search = "?z=1"`, `a.hash = "x"`, `a.href = "http://b.test/"`, "a.searchParams.sort()", `a.pathname = "/other"`, `Reflect.set(a, "search", "?z=1")`]);
twice(`new Headers({ a: "b" })`, [`a.get("a")`, `a.has("a")`, "[...a].length", "a.count"], [`a.set("a", "9")`, `a.append("a", "9")`, `a.delete("a")`, `a.set("c", "9")`, `Headers.prototype.set.call(a, "a", "9")`]);
twice(`new URLSearchParams("a=b")`, [`a.get("a")`, `a.has("a")`, "a.size", "String(a)"], [`a.set("a", "9")`, `a.append("a", "9")`, `a.delete("a")`, "a.sort()"]);
twice("new AbortController()", ["a.signal.aborted", "String(a.signal.reason)"], ["a.abort()", `a.abort("why")`, "AbortController.prototype.abort.call(a)"]);
twice(`new Event("e", { cancelable: true })`, ["a.defaultPrevented", "a.cancelBubble", "a.returnValue"], ["a.preventDefault()", "a.stopPropagation()", "a.returnValue = false", "a.cancelBubble = true"]);
twice(`new Response("text")`, ["a.bodyUsed", "a.body?.locked"], ["a.text()", "a.body.getReader()", "a.arrayBuffer()", "a.clone()"]);
twice("new ReadableStream()", ["a.locked"], ["a.getReader()", "a.tee()", "a.pipeThrough(new TransformStream())"]);
twice("new FormData()", [`a.has("k")`, `a.get("k")`, "[...a].length"], [`a.set("k", "v")`, `a.append("k", "v")`]);
twice("function (p, q) {}", ["a.length", "a.name", "typeof a.prototype"], [`Object.defineProperty(a, "length", { value: 9 })`, `Object.defineProperty(a, "name", { value: "other" })`, "a.prototype = 5", "delete a.length", "delete a.name"]);
twice("new EventEmitter()", [`a.listenerCount("k")`, "a.eventNames().length", `a.emit("k")`], [`a.on("k", () => {})`, `a.once("k", () => {})`, `a.addListener("k", () => {})`, "a.removeAllListeners()"], `import { EventEmitter } from "node:events";\n`);
twice("new ArrayBuffer(4, { maxByteLength: 8 })", ["a.byteLength", "a.detached", "new Uint8Array(a).length"], ["a.resize(8)", "a.resize(0)", "a.transfer()", "structuredClone(a, { transfer: [a] })", "ArrayBuffer.prototype.resize.call(a, 8)"]);
twice("5", ["arguments[0]", "arguments.length", "a"], ["arguments[0] = 9", "a = 9", "arguments.length = 0", "Array.prototype.fill.call(arguments, 9)", "Object.assign(arguments, [9])", "Array.prototype.push.call(arguments, 9)", "delete arguments[0]", "Reflect.set(arguments, 0, 9)"]);

export function generate(random: Random): string {
  const lines = [
    `const told = [];`,
    `function guarded(f) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "another error"; } }`,
  ];
  const imports = new Set<string>();
  const scenes = random.between(2, 5);
  for (let scene = 1; scene <= scenes; scene++) {
    const row = random.pick(rows);
    const named = (text: string) => text.replaceAll(/\bP\b/g, `P${scene}`);
    if (row.head.startsWith("import ")) imports.add(row.head.trimEnd());
    else if (row.head) lines.push(named(row.head).trimEnd());
    lines.push(`function observe${scene}(a) { ${row.observe(row.writer)} }`);
    lines.push(`console.log("s${scene}", guarded(() => observe${scene}(${named(row.make)})), guarded(() => observe${scene}(${named(row.make)})));`);
  }
  return [...imports, ...lines, "export {};", ""].join("\n");
}
