// Methods fill a Buffer out of two holders under one counter: Buffers, other views, lists, objects and nothing at all come as the one and as the other.
"use strict";
class Mixer {
  constructor(size) { this.size = size; this.out = Buffer.alloc(size); this.turns = 0; }
  added(a, b) { const out = this.out; for (let i = 0; i < this.size; i++) out[i] = a[i] + b[i]; this.turns++; return out; }
  masked(a, b) { const out = Buffer.alloc(this.size); for (let i = 0; i < out.length; i++) out[i] = a[i] ^ b[i]; return out; }
  woven(a, b) { const out = this.out; for (let i = 0; i + 1 < this.size; i += 2) { out[i] = a[i >> 1]; out[i + 1] = b[i >> 1]; } return out; }
  under(a, b, key) { const out = Buffer.alloc(this.size); for (let i = 0; i < this.size; i++) out[i] = a[i] * 2 - b[(i + key) % this.size]; return out; }
}
const hidden = {
  added(out, a, b, n) { for (let i = 0; i < n; i++) out[i] = a[i] + b[i]; return out; },
  kept(out, a, b, n) { for (let i = 0; i < n; i++) out[i] += a[i] * 2 - b[i]; return out; },
  above(out, line, last, n) { for (let i = 0; i < n; i++) out[i] = line[i + 1] + (last ? last[i] : 0); return out; },
  fills(a, b, n) { const out = Buffer.alloc(n); for (let i = 0; i < n; i++) out[i] = a[i] ^ b[i]; return out; },
};
class Keeper { constructor(n) { this.n = n; this.last = null; } put(line) { const out = Buffer.alloc(this.n); for (let i = 0; i < this.n; i++) { const up = this.last ? this.last[i] : 0; out[i] = line[i] - up; } this.last = out; return out; } twice(line, other) { const out = this.last; for (let i = 0; i < this.n; i++) out[i] = line[i] + other[i]; return out; } }
globalThis["fill" + process.pid] = { hidden, Keeper };
const makers = { buffer: n => Buffer.from(Array.from({ length: n }, (_, i) => i * 21)), bytes: n => Uint8Array.from({ length: n }, (_, i) => 250 - i), signed: n => Int8Array.from({ length: n }, (_, i) => i - 4), doubles: n => Float64Array.from({ length: n }, (_, i) => i * 1.75), list: n => Array.from({ length: n }, (_, i) => i * 3), fractions: n => Array.from({ length: n }, (_, i) => i / 3 + 250), texts: n => Array.from({ length: n }, (_, i) => "" + i), holes: n => { const l = new Array(n); l[2] = 5; return l; }, short: () => [1, 2], object: () => ({ 0: 4, 1: "5", 3: null }), text: () => "90210", number: () => 7, nothing: () => null, missing: () => undefined };
globalThis.makers = makers; globalThis.Mixer = Mixer;
const seen = globalThis["fill" + process.pid];
for (let k = 0; k < 60; k++) { const m = globalThis.makers; seen.hidden.added(m.buffer(8), m.buffer(8), m.bytes(8), 8); seen.hidden.kept(m.bytes(8), m.bytes(8), m.list(8), 8); seen.hidden.above(m.buffer(8), m.buffer(9), k & 1 ? m.buffer(8) : null, 8); seen.hidden.fills(m.bytes(8), m.buffer(8), 8); const keeper = new seen.Keeper(8); keeper.put(m.buffer(8)); keeper.put(m.bytes(8)); keeper.twice(m.bytes(8), m.buffer(8)); }
for (const one of ["buffer", "list", "fractions", "texts", "holes", "object", "nothing"]) { const m = globalThis.makers, out = []; for (const way of [() => seen.hidden.added(m.buffer(6), m[one](6), m.bytes(6), 6), () => seen.hidden.kept(m[one](6), m.bytes(6), m.list(6), 6), () => seen.hidden.above(m.bytes(6), m[one](7), m[one](6), 6), () => seen.hidden.fills(m.list(6), m[one](6), 6), () => { const keeper = new seen.Keeper(6); keeper.put(m[one](6)); return keeper.put(m.doubles(6)); }, () => { const keeper = new seen.Keeper(6); keeper.last = m[one](6); return keeper.twice(m.bytes(6), m.list(6)); }]) { try { out.push(Array.from({ length: 6 }, (_, i) => String(Math.round(way.held === undefined ? (way.held = way())[i] : way.held[i]))).join()); } catch (error) { out.push(error.constructor.name); } } console.log(one, out.join(" ")); }
for (let k = 0; k < 60; k++) { const mixer = new Mixer(8), a = globalThis.makers.buffer(8), b = k & 1 ? globalThis.makers.bytes(8) : globalThis.makers.list(8); mixer.added(a, b); mixer.masked(a, b); mixer.woven(a, b); mixer.under(a, b, k); }
for (const [one, makeOne] of Object.entries(globalThis.makers)) for (const [other, makeOther] of Object.entries(globalThis.makers)) { const mixer = new globalThis.Mixer(6), out = []; for (const way of ["added", "masked", "woven", "under"]) { try { out.push(mixer[way](makeOne(6), makeOther(6), 2).toString("hex")); } catch (error) { out.push(error.constructor.name); } } console.log(one, other, out.join(" ")); }
const self = new globalThis.Mixer(5); self.out.set([1, 2, 3, 4, 5]); console.log(self.added(self.out, self.out).toString("hex"), self.woven(self.out, self.out.subarray(1)).toString("hex"), self.turns); const gone = Buffer.from(new ArrayBuffer(5)); structuredClone(gone.buffer, { transfer: [gone.buffer] }); console.log(self.added(gone, [1, 2, 3, 4, 5]).toString("hex"), self.masked(gone, gone).toString("hex"));
let order = ""; const loud = n => ({ get 0() { order += n; self.size = 2; return n; }, 1: 9 }); console.log(self.added(loud(1), loud(2)).toString("hex"), order, self.size); Reflect.set(self, "out", [0, 0]); self.size = 2; console.log(String(self.added(makers.buffer(3), makers.fractions(3)))); Reflect.set(self, "out", null); try { self.added([1], [2]); } catch (error) { console.log(error.constructor.name, self.turns); }
