// Evaluated text stores under symbols: over own values, new ones, inherited ones, accessors, what is read-only, frozen or sealed, on objects of every kind, prototypes and objects that others watch, with collections between.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const key = Symbol("key");
class Compiled { [key] = 1; set [Symbol.for("set")](v) { this.seen = v; } }
const program = { collect: () => globalThis.Bun?.gc?.(true), key, Compiled, literal: { [key]: 1 }, read: o => [o[key], o[Symbol.toStringTag]], name: o => Object.prototype.toString.call(o) };
const text = `
const lines = [];
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "{}" : typeof v === "function" ? "f" : typeof v === "symbol" ? "s" : String(v);
const attempt = (name, f) => { let r; try { r = show(f()); } catch (e) { r = e?.name; } lines.push(name + " " + r); };
const store = (o, k, v) => { o[k] = v; return o[k]; };
const strict = (o, k, v) => { "use strict"; o[k] = v; return o[k]; };
const a = Symbol("a"), b = Symbol("b"), { key } = program, set = Symbol.for("set");
const values = [1, "two", 3.5, {}, [], null, undefined, () => 1, true, -0, 5n, Symbol()];
const makers = [() => ({}), () => ({ [a]: 1 }), () => ({ [a]: 1, [b]: 2, x: 3 }), () => Object.create({ [a]: "up" }), () => Object.create(null), () => Object.freeze({ [a]: 1 }), () => Object.seal({ [a]: 1 }), () => Object.preventExtensions({ [b]: 1 }), () => Object.defineProperty({}, a, { value: 1 }), () => Object.defineProperty({}, a, { value: 1, writable: true }), () => Object.create(Object.defineProperty({}, a, { value: 1 })), () => ({ get [a]() { return "g"; } }), () => ({ t: 0, set [a](v) { this.t = v; }, get [a]() { return this.t; } }), () => [1], () => () => 1, () => new Map, () => new Proxy({ [a]: 1 }, {}), () => new Proxy({}, { set: () => false }), () => new program.Compiled, () => program.literal, () => new (class { [a] = 1; })(), () => new Date(0), () => new Uint8Array(1), () => (() => { const o = {}; for (let i = 0; i < 100; i++) o["k" + i] = i; o[a] = 1; return o; })(), () => (() => { const o = { [a]: 1, [b]: 2 }; delete o[a]; return o; })(), () => 5, () => "s", () => null, () => Symbol.prototype];
for (let turn = 0; turn < 3; turn++) {
  for (const [m, make] of makers.entries()) for (const k of [a, b, key, set, Symbol.iterator, Symbol.toStringTag]) { if (m === 28) continue; for (const f of [store, strict]) attempt(m, () => { const o = make(), r = []; for (let i = 0; i < 6; i++) { try { r.push(f(o, k, values[(i + turn) % values.length])); } catch (e) { r.push(e.name); } } return r; }); }
  attempt("tags", () => { const o = { [Symbol.toStringTag]: "A" }, r = []; for (let i = 0; i < 8; i++) { store(o, Symbol.toStringTag, "T" + i); r.push(program.name(o), String(o), program.read(o)[1]); } return r; });
  attempt("primitives", () => { const o = { [Symbol.toPrimitive]: () => 1 }, r = []; for (let i = 0; i < 6; i++) { store(o, Symbol.toPrimitive, () => i * 2); r.push(+o, o + ""); } return r; });
  attempt("iterators", () => { const o = { [Symbol.iterator]: function* () { yield 1; } }, r = []; for (let i = 0; i < 6; i++) { store(o, Symbol.iterator, function* () { yield i; yield i + 1; }); r.push([...o]); } return r; });
  attempt("above", () => { const p = { [a]: 0 }, o = Object.create(p), r = []; for (let i = 0; i < 9; i++) { store(p, a, i); r.push(o[a]); if (i === 5) store(o, a, "own"); } return r; });
  attempt("compiled", () => { const r = []; for (let i = 0; i < 8; i++) { const o = i % 2 ? new program.Compiled : { [key]: 0 }; store(o, key, i); r.push(program.read(o)[0]); store(o, key, "t"); r.push(program.read(o)[0]); } return r; });
  attempt("young values", () => { const l = Array.from({ length: 40 }, () => ({ [a]: 0 })); program.collect(); for (let i = 0; i < 400; i++) store(l[i % 40], a, { i }); program.collect(); let s = 0; for (const o of l) s += o[a].i; return s; });
  attempt("watched", () => { const o = { [a]: 1, x: 1 }, f = () => o[a] + o.x; let s = 0; for (let i = 0; i < 50; i++) { s += f(); if (i % 10 === 9) store(o, a, i); } return s; });
  attempt("many symbols", () => { const ks = Array.from({ length: 70 }, (_, i) => Symbol(i)), o = {}; for (const [i, k] of ks.entries()) o[k] = i; for (let t = 0; t < 3; t++) for (const [i, k] of ks.entries()) store(o, k, o[k] + i); return ks.map(k => o[k]).join(); });
}
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
