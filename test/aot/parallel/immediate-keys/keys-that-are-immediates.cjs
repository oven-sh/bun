// undefined, null, true and false as keys name the properties of those names.
const lines = [];
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "symbol" ? "symbol" : typeof v === "function" ? "function" : typeof v === "object" && v ? JSON.stringify(v) : String(v));
function attempt(f) { try { return show(f()); } catch (e) { return e.name; } }
function get(o, k) { return o[k]; }
function set(o, k, v) { o[k] = v; return o[k]; }
class Strict { static set(o, k, v) { o[k] = v; return o[k]; } }
const setStrict = Strict.set;
function has(o, k) { return k in o; }
function remove(o, k) { return delete o[k]; }
function call(o, k, v) { return o[k](v); }
function update(o, k) { o[k]++; o[k] += 2; o[k] ??= 5; return o[k]; }
class P { constructor() { this.true = 1; this.x = 2; } get null() { return "getter " + this.x; } set false(v) { this.x = "set " + v; } undefined(v) { return "method " + v; } }
class Sub extends Array {}
const seen = [];
const objects = () => ({
  literal: { true: 1, undefined: 2, a: 3 }, empty: {}, bare: Object.create(null), instance: new P(), array: [1, 2, 3], sub: Sub.from([1]), typed: new Float64Array(2), f: function named() {}, arrow: () => 1, text: "abc", number: 5, boolean: true, symbol: Symbol("s"), big: 5n,
  frozen: Object.freeze({ null: 4 }), sealed: Object.seal({ false: 1 }), readonly: Object.defineProperty({}, "undefined", { value: 9, configurable: true }), accessor: { get undefined() { return "get"; }, set undefined(v) { seen.push(v); }, get null() { throw new RangeError("null"); } },
  proxy: new Proxy({ true: 8 }, { get(t, k, r) { seen.push("get " + typeof k + " " + String(k)); return Reflect.get(t, k, r); }, set(t, k, v, r) { seen.push("set " + typeof k + " " + String(k) + " " + show(v)); return Reflect.set(t, k, v, r); }, has(t, k) { seen.push("has " + String(k)); return k in t; } }),
  child: Object.create({ true: "inherited", set null(v) { seen.push("inherited " + show(v)); } }), map: new Map([[undefined, 1]]), date: new Date(0), error: Object.assign(new Error("e"), { undefined: 1 }), re: /a/g, args: (function () { return arguments; })(1, 2), nothing: undefined, none: null,
});
const keys = [undefined, null, true, false, "undefined", "null", "true", "false", NaN, 1.5, -1, 0];
globalThis.keep = [P, objects, get, set];
for (let round = 0; round < 3; round++) {
  const all = objects();
  for (const name of Object.keys(all)) {
    const o = all[name];
    const row = [];
    for (const k of keys) row.push(attempt(() => get(o, k)), attempt(() => has(o, k)));
    for (const k of keys.slice(0, 5)) row.push(attempt(() => set(o, k, show(k) + round)), attempt(() => setStrict(o, k, round ? k : -0)), attempt(() => update(o, k)), attempt(() => call(o, k, 1)));
    for (const k of keys.slice(0, 4)) row.push(attempt(() => remove(o, k)), attempt(() => get(o, k)));
    lines.push(round + " " + name + " " + row.join(" | ") + " | " + (o && typeof o === "object" && name !== "proxy" ? Object.keys(o).join() : "") + " | " + seen.splice(0).join(";"));
  }
}
const states = {};
let changes = 0;
function enable(id) { if (states[id] !== true) { changes++; states[id] = true; } }
function disable(id) { if (states[id] !== false) { changes++; states[id] = false; } }
const gl = {};
for (let i = 0; i < 3000; i++) { enable(gl.CULL); disable(gl.DEPTH); if (i & 1) enable(null); else disable(null); enable(i % 3 === 0); }
lines.push(changes + " " + JSON.stringify(states));
lines.push(show(get({}, undefined)), show(get([], undefined)), show(get("", undefined)), show(get(5, undefined)), show(get(new P(), undefined)));
console.log(lines.join("\n"));
