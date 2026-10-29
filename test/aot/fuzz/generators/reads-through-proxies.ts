// Reads through a proxy: what the target holds fast (a property that is neither configurable nor writable, an accessor without a getter), what the
// trap answers, how the handler has its trap, and how the program reads. The language holds the trap's answer to the target: TypeError where it
// lies. Targets whose fast properties are in no ordinary table are the point: the length of a frozen array or of a String object, the prototype of
// a class, Math.PI, globalThis.NaN, lastIndex of a frozen RegExp, another proxy. Each cell is a function of its own and runs twice.
// What --aot makes fast that plain Bun does not (the built-in prototypes, the globals) is not among the targets.

/** Name, target, the key that is read. LATER: the target is frozen behind the first read. */
// prettier-ignore
const targets: [string, string, string][] = [
  ["frozen literal", "Object.freeze({ k: 1 })", "k"],
  ["fast value", "Object.defineProperty({}, \"k\", { value: 1 })", "k"],
  ["fast among others", "Object.defineProperty({ a: 1, b: 2 }, \"k\", { value: 1, enumerable: true })", "k"],
  ["another is fast", "Object.defineProperty({ k: 1 }, \"other\", { value: 1 })", "k"],
  ["not configurable, writable", "Object.defineProperty({}, \"k\", { value: 1, writable: true })", "k"],
  ["configurable, not writable", "Object.defineProperty({}, \"k\", { value: 1, configurable: true })", "k"],
  ["a setter alone, fast", "Object.defineProperty({}, \"k\", { set(v) {} })", "k"],
  ["a getter, fast", "Object.defineProperty({}, \"k\", { get() { return 1; } })", "k"],
  ["a setter alone, configurable", "Object.defineProperty({}, \"k\", { set(v) {}, configurable: true })", "k"],
  ["sealed", "Object.seal({ k: 1 })", "k"],
  ["not extensible", "Object.preventExtensions({ k: 1 })", "k"],
  ["not extensible, absent", "Object.preventExtensions({})", "k"],
  ["plain", "({ k: 1 })", "k"],
  ["absent", "({})", "k"],
  ["frozen NaN", "Object.freeze({ k: NaN })", "k"],
  ["frozen zero", "Object.freeze({ k: 0 })", "k"],
  ["frozen negative zero", "Object.freeze({ k: -0 })", "k"],
  ["frozen undefined", "Object.freeze({ k: undefined })", "k"],
  ["frozen object", "Object.freeze({ k: SAME })", "k"],
  ["frozen text", "Object.freeze({ k: \"x\" })", "k"],
  ["frozen array", "Object.freeze([1, 2])", "length"],
  ["array", "[1, 2]", "length"],
  ["array, length fast", "Object.defineProperty([1, 2], \"length\", { writable: false })", "length"],
  ["sealed array", "Object.seal([1, 2])", "length"],
  ["frozen empty array", "Object.freeze([])", "length"],
  ["class", "class K {}", "prototype"],
  ["function", "function () {}", "prototype"],
  ["frozen function", "Object.freeze(function f(a) {})", "name"],
  ["frozen function's length", "Object.freeze(function f(a) {})", "length"],
  ["function's name", "function f(a) {}", "name"],
  ["frozen arrow", "Object.freeze(() => {})", "name"],
  ["bound", "Object.freeze((function () {}).bind(null))", "name"],
  ["frozen class's static", "Object.freeze(class K { static k = 1; })", "k"],
  ["String object", "new String(\"ab\")", "length"],
  ["Math", "Math", "PI"],
  ["Number", "Number", "MAX_VALUE"],
  ["Number's EPSILON", "Number", "EPSILON"],
  ["Symbol", "Symbol", "iterator"],
  ["global NaN", "globalThis", "NaN"],
  ["global undefined", "globalThis", "undefined"],
  ["global Infinity", "globalThis", "Infinity"],
  ["RegExp", "/x/g", "lastIndex"],
  ["frozen RegExp", "Object.freeze(/x/g)", "lastIndex"],
  ["frozen Error", "Object.freeze(new Error(\"m\"))", "message"],
  ["frozen Error's stack", "Object.freeze(new Error(\"m\"))", "stack"],
  ["a proxy of frozen", "new Proxy(Object.freeze({ k: 1 }), {})", "k"],
  ["a proxy that says fast", "new Proxy({ k: 1 }, { getOwnPropertyDescriptor(t, k) { log.push(\"inner describes \" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } })", "k"],
  ["a proxy of frozen that logs", "new Proxy(Object.freeze({ k: 1 }), { getOwnPropertyDescriptor(t, k) { log.push(\"inner describes \" + String(k)); return Reflect.getOwnPropertyDescriptor(t, k); } })", "k"],
  ["many properties, one fast", "(() => { const o = {}; for (let i = 0; i < 200; i++) o[\"p\" + i] = i; for (let i = 0; i < 100; i++) delete o[\"p\" + i]; return Object.defineProperty(o, \"k\", { value: 1 }); })()", "k"],
  ["many properties, frozen", "(() => { const o = { k: 1 }; for (let i = 0; i < 200; i++) o[\"p\" + i] = i; delete o.p7; return Object.freeze(o); })()", "k"],
  ["frozen instance", "Object.freeze(new (class C { k = 1; })())", "k"],
  ["instance", "new (class C { k = 1; })()", "k"],
  ["frozen, no prototype", "Object.freeze(Object.assign(Object.create(null), { k: 1 }))", "k"],
  ["frozen heir of Array", "Object.freeze(new (class L extends Array {})(3))", "length"],
  ["strict arguments", "(function () { \"use strict\"; return arguments; })(1)", "callee"],
  ["frozen arguments", "Object.freeze((function () { return arguments; })(1, 2))", "length"],
  ["frozen getter", "Object.freeze({ get k() { return 1; } })", "k"],
  ["fast on the prototype only", "Object.create(Object.freeze({ k: 1 }))", "k"],
  ["String.prototype", "String.prototype", "length"],
  ["Array", "Array", "prototype"],
  ["Object", "Object", "prototype"],
  ["Uint8Array", "Uint8Array", "BYTES_PER_ELEMENT"],
  ["Uint8Array.prototype", "Uint8Array.prototype", "BYTES_PER_ELEMENT"],
  ["module namespace", "NAMESPACE", "sep"],
  ["frozen Date", "Object.freeze(Object.assign(new Date(0), { k: 1 }))", "k"],
  ["frozen Map", "Object.freeze(Object.assign(new Map(), { k: 1 }))", "k"],
  ["frozen typed array's own", "Object.defineProperty(new Uint8Array(2), \"k\", { value: 1 })", "k"],
  ["frozen Promise", "Object.freeze(Object.assign(Promise.resolve(), { k: 1 }))", "k"],
  ["JSON parsed, frozen", "Object.freeze(JSON.parse('{\"k\":1}'))", "k"],
  ["frozen later", "LATER", "k"],
];
// prettier-ignore
export const answers: [string, string][] = [
  ["the truth", "Reflect.get(t, k)"],
  ["five", "5"],
  ["undefined", "undefined"],
  ["one", "1"],
  ["NaN", "NaN"],
  ["zero", "0"],
  ["negative zero", "-0"],
  ["the same object", "SAME"],
  ["x", "\"x\""],
  ["two", "2"],
];
/** TRAP stands for the function. */
// prettier-ignore
const handlers: [string, string][] = [
  ["an arrow", "{ get: TRAP }"],
  ["a method", "{ get(t, k, r) { return (TRAP).call(this, t, k, r); } }"],
  ["frozen handler", "Object.freeze({ get: TRAP })"],
  ["beside other traps", "{ has() { log.push(\"has\"); return true; }, getOwnPropertyDescriptor(t, k) { log.push(\"outer describes\"); return Reflect.getOwnPropertyDescriptor(t, k); }, get: TRAP, set() { return true; } }"],
  ["inherited", "Object.create({ get: TRAP })"],
  ["behind a getter", "{ get get() { log.push(\"asked for the trap\"); return TRAP; } }"],
  ["the handler is a proxy", "new Proxy({ get: TRAP }, {})"],
  ["bound", "{ get: (TRAP).bind(null) }"],
  ["the trap is a proxy", "{ get: new Proxy(TRAP, {}) }"],
  ["a field of an instance", "new (class H { get = TRAP; })()"],
  ["a method of a class", "new (class H { get(t, k, r) { return (TRAP).call(this, t, k, r); } })()"],
  ["not enumerable", "Object.defineProperty({}, \"get\", { value: TRAP })"],
  ["no prototype", "Object.assign(Object.create(null), { get: TRAP })"],
  ["an array for a handler", "Object.assign([], { get: TRAP })"],
  ["a function for a handler", "Object.assign(function () {}, { get: TRAP })"],
  ["many properties", "(() => { const h = {}; for (let i = 0; i < 200; i++) h[\"p\" + i] = i; delete h.p3; h.get = TRAP; return h; })()"],
];
/** P stands for the proxy, K for the key. */
// prettier-ignore
const reads: [string, string][] = [
  ["p.K", "P.K"],
  ["p[\"K\"]", "P[\"K\"]"],
  ["p[name]", "P[unknown(\"K\")]"],
  ["a pattern", "(({ K: v }) => v)(P)"],
  ["p?.K", "P?.K"],
  ["Reflect.get", "Reflect.get(P, \"K\")"],
  ["an heir's", "Object.create(P).K"],
  ["super.K", "({ __proto__: P, m() { return super.K; } }).m()"],
  ["typeof", "typeof P.K"],
  ["p.K ?? d", "P.K ?? \"d\""],
  ["twice", "[P.K, P.K].length && P.K"],
  ["in a loop", "(() => { let v; for (let i = 0; i < 3; i++) v = P.K; return v; })()"],
  ["a call", "(() => { const f = P.K; return typeof f === \"function\" ? \"a function\" : f; })()"],
  ["by Object.entries' kin", "Object.getOwnPropertyNames(P).includes(\"K\") && P.K"],
];

const helpers = `const unknown = x => x; const SAME = { same: true }; let log = [];
const one = x => x === undefined ? "<undefined>" : x === null ? "<null>" : typeof x === "number" ? (x !== x ? "<NaN>" : Object.is(x, -0) ? "<-0>" : String(x)) : typeof x === "string" ? JSON.stringify(x.length > 40 ? x.slice(0, 12) + ".." : x) : typeof x === "function" ? "<function>" : typeof x === "symbol" ? String(x) : typeof x === "object" ? (x === SAME ? "<the same object>" : "<object>") : String(x);
const say = (label, f) => { const all = []; for (let i = 0; i < 2; i++) { log = []; let r; try { r = one(f()); } catch (e) { r = "throws " + e.constructor.name; } all.push(r + (log.length ? " [" + log.join("; ") + "]" : "")); } console.log(label + " ==> " + (all[0] === all[1] ? all[0] : all.join(" THEN "))); };`;

export function program(answer: string): { file: string; text: string } {
  const lines = ['import * as NAMESPACE from "node:path";', helpers];
  const trap = `(function (t, k, r) { log.push((this === H ? "this is the handler" : this === undefined ? "this is undefined" : this === null ? "this is null" : "this is other") + ", " + (t === T ? "the target" : "ANOTHER TARGET") + ", " + typeof k + " " + String(k) + ", " + (r === P ? "the proxy" : "another receiver")); return ${answer}; })`;
  let n = 0;
  targets.forEach(([name, target, key], t) => {
    handlers.forEach(([has, handler], h) => {
      reads.forEach(([how, read], r) => {
        // The whole square for the first four handlers and the first six reads, and a diagonal beyond them.
        if (!(h < 4 && r < 6) && (h + r + t) % 7 !== 0) return;
        n++;
        const isFrozenLater = target === "LATER";
        lines.push(`function f${n}() { const T = ${isFrozenLater ? "{ k: 1 }" : target}; const H = ${handler.replaceAll("TRAP", () => trap)}; const P = new Proxy(T, H); ${isFrozenLater ? "P.k; Object.freeze(T); log.length = 0; " : ""}return ${read.replaceAll("K", key)}; } say(${JSON.stringify(`${name} .${key} | ${has} | ${how}`)}, f${n});`);
      });
    });
  });
  return { file: "main.mjs", text: lines.join("\n") + "\n" };
}
