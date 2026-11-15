// Ordinary objects that names come to and go from many times, in evaluated text and in compiled functions, read, listed, copied, frozen, inherited from and handed over in between.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
function drop(o, k) { delete o[k]; }
function add(o, k, v) { o[k] = v; }
function get(o, k) { return o[k]; }
function named(o) { return [o.a, o.b, o.k3, o.zz]; }
function sum(o) { let s = 0; for (const k in o) s += +o[k] || 0; return s; }
const program = { collect: () => globalThis.Bun?.gc?.(true), drop, add, get, named, sum };
const text = `
const lines = [];
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "string" ? JSON.stringify(v) : typeof v === "object" && v ? "{" + Object.entries(v).slice(0, 12).map(e => e.join(":")).join() + "}" : typeof v === "function" ? "f" : String(v);
const attempt = (name, f) => { let r; try { r = show(f()); } catch (e) { r = e?.name; } lines.push(name + " " + r); };
const s = Symbol("s");
const makers = [() => ({ a: 1 }), () => ({}), () => Object.create(null), () => Object.create({ up: 1, b: "above" }), () => ({ a: 1, b: 2, c: 3, [s]: 4 }), () => new (class { x = 1; get a() { return "got"; } })(), () => JSON.parse('{"a":1,"k3":"parsed"}'), () => Object.assign({}, { a: 1, zz: 2 }), () => Object.fromEntries([["a", 1], ["k1", 2]]), () => [1, 2, 3], () => function () {}, () => Object.defineProperty({}, "a", { get() { return this.b; }, enumerable: true, configurable: true }), () => ({ 0: "zero", 5: "five", a: 1 })];
for (let turn = 0; turn < 2; turn++) for (const [m, make] of makers.entries()) {
  for (const n of [1, 2, 3, 10, 40, 150]) attempt("map " + m + " " + n, () => {
    const o = make(), r = [];
    for (let i = 0; i < 4 * n + 12; i++) {
      o["k" + i % n] = i;
      if (i >= n) { if (i % 3) delete o["k" + (i + 1) % n]; else program.drop(o, "k" + (i + 1) % n); }
      if (i % 7 === 0) r.push(program.get(o, "k" + i % n), o["k" + (i + 1) % n], program.named(o).map(String).join());
      if (i % 11 === 0) program.add(o, "added", i);
      if (i % 13 === 0) delete o.added;
    }
    return [r, Object.keys(o).length, Object.keys(o).slice(0, 6), JSON.stringify(o).length, program.sum(o), "k0" in o, Object.hasOwn(o, "k1"), o[s]];
  });
  attempt("one name " + m, () => { const o = make(); let t = 0; for (let i = 0; i < 300; i++) { o.b = i; t += o.b; delete o.b; if (o.b !== undefined) t += 0.5; } return [t, Object.keys(o), o.b === undefined]; });
  attempt("order " + m, () => { const o = make(); for (let i = 0; i < 9; i++) { o["p" + i] = i; delete o["p" + (i - 2)]; } o.p3 = "again"; delete o.p8; o.p8 = "last"; return Object.keys(o); });
  attempt("listed while it changes " + m, () => { const o = make(); for (let i = 0; i < 20; i++) { o["q" + i] = i; delete o["q" + (i - 3)]; } const seen = []; for (const k in o) { seen.push(k); delete o.q18; o["r" + seen.length % 2] = 1; if (seen.length > 30) break; } return seen; });
  attempt("then still " + m, () => { const o = make(); for (let i = 0; i < 12; i++) { o["q" + i] = i; delete o["q" + (i - 1)]; } const c = { ...o }, d = Object.assign({}, o), e = structuredClone(m > 9 && m < 12 ? {} : Object.getPrototypeOf(o) === Object.prototype ? { ...o, [s]: undefined } : {}); Object.defineProperty(o, "fixed", { value: 1, configurable: false }); let failed = 0; try { (function () { "use strict"; delete o.fixed; })(); } catch (x) { failed = x.name; } Object.preventExtensions(o); try { (function () { "use strict"; o.late = 1; })(); } catch (x) { failed += x.name; } delete o.q11; Object.freeze(o); return [Object.keys(c), Object.keys(d), Object.keys(e).length, failed, Object.keys(o), Object.isFrozen(o)]; });
  attempt("above others " + m, () => { const p = make(), o = m === 10 ? {} : Object.create(p), r = []; for (let i = 0; i < 24; i++) { p.b = i; r.push(o.b); if (i % 2) delete p.b; r.push(o.b, program.get(o, "b")); } return r; });
}
attempt("least recently used", () => { const at = {}, order = []; let hits = 0; for (let i = 0; i < 3000; i++) { const k = "k" + (i * 7919 % 211); if (at[k] !== undefined) { hits += at[k]; delete at[k]; order.splice(order.indexOf(k), 1); } at[k] = i % 5; order.push(k); if (order.length > 60) delete at[order.shift()]; if (i === 1500) program.collect(); } return [hits, Object.keys(at).length, order.slice(0, 4), Object.keys(at).slice(0, 4)]; });
attempt("many maps", () => { const l = Array.from({ length: 60 }, () => ({})); let t = 0; for (let i = 0; i < 6000; i++) { const o = l[i % 60]; o["x" + i % 7] = i; delete o["x" + (i + 3) % 7]; t += o["x" + (i + 1) % 7] ?? 1; } program.collect(); return [t, l.map(o => Object.keys(o).join("")).join().length]; });
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
