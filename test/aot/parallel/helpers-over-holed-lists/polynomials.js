// A polynomial over lists of every storage, with holes, texts, objects, views and accessors, called in a loop: elements that are undefined give NaN, everything else as written.
function help(c, x) { let s = 0; for (let i = 3; i >= 0; i--) s = s * x + c[i]; return s; }
const methods = { help, go(c) { let t = 0; for (let i = 0; i < 12; i++) t += methods.help(c, i / 4); return t; } };
globalThis.kept = methods;
function work(c) { return methods.go(c); }
const lists = [
  () => [1.5, 2.5, 3.5, 4.5], () => [1, 2, 3, 4], () => JSON.parse("[1,2,3,4]"), () => JSON.parse("[1.5,2.5,3,4]"),
  () => [1.5, , 3.5, 4.5], () => [1, , 3, 4], () => { const a = [1.5, 2.5, 3.5, 4.5]; delete a[1]; return a; }, () => { const a = [1, 2, 3, 4]; delete a[2]; return a; },
  () => { const a = new Array(4); a[0] = 1.5; a[2] = 2.5; a[3] = 3.5; return a; }, () => new Array(4), () => [], () => [1.5, 2.5], () => [1, 2, 3],
  () => [undefined, 2, 3.5, 4], () => [1, undefined, 3, 4], () => [null, 2, 3, 4], () => [true, 2, 3, 4], () => ["1", 2, 3, 4], () => [1, 2, 3, "x"], () => [NaN, -0, 1e300, 4],
  () => [{ valueOf() { calls++; return 7; } }, 2, 3, 4], () => [1, { toString() { calls++; return "9"; } }, 3, 4], () => [1n, 2, 3, 4], () => [Symbol.iterator, 2, 3, 4],
  () => new Uint8Array([1, 2, 3, 4]), () => new Float64Array([1.5, 2.5, 3.5, 4.5]), () => new Int32Array([1, -2, 3]), () => "1234", () => ({ 0: 1, 1: 2, 2: 3, 3: 4, length: 4 }),
  () => Object.freeze([1.5, 2.5, 3.5, 4.5]), () => new (class extends Array {})(1, 2, 3, 4), () => { const a = [1, 2, 3, 4]; Object.defineProperty(a, 2, { get() { calls++; return 0.5; }, configurable: true }); return a; },
  () => new Proxy([1, 2, 3, 4], { get(t, k) { calls++; return Reflect.get(t, k); } }), () => { const a = [1.5, , 3.5, 4.5]; Object.setPrototypeOf(a, { __proto__: Array.prototype, 1: 8 }); return a; }, () => undefined,
  () => { const a = []; a[100000] = 1; a[1] = 2; return a; }, () => [1.5, "x", 3.5, 4.5].map(x => typeof x === "string" ? 2 : x),
];
let calls = 0, out = [];
function poke(c) { if (Array.isArray(c) && !Object.isFrozen(c)) { c[1] = calls & 1 ? "t" : 0.25; if (calls % 3 === 2) c.length = 2; calls++; } }
function shown(x) { return typeof x === "number" ? (Object.is(x, -0) ? "-0" : String(Math.round(x * 1e6) / 1e6)) : typeof x + ":" + String(x); }
function run(which) { for (let k = 0; k < lists.length; k++) { let a; try { a = shown(work(lists[k]())); } catch (e) { a = e.constructor.name; } out.push(which + k + "=" + a + "/" + calls); } }
run("a"); run("b");
run("c");
console.log(out.join("\n"));
