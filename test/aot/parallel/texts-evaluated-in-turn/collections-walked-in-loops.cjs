// for (const x of ..) over a Set and over the keys and values of a Map that change while they are walked, in evaluated text.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
class Point { constructor(x, y) { this.x = x; this.y = y; } toString() { return "P" + this.x; } }
globalThis.kept = new Set(["kept", 1, null]);
const program = {
  collect: () => globalThis.Bun?.gc?.(true), Point, drop: (c, k) => c.delete(k), put: (c, k, v) => c instanceof Map ? c.set(k, v) : c.add(k), clear: c => c.clear(),
  walk: c => { let r = ""; for (const x of c) { r += String(x); if (r.length > 40) break; } return r; }, set: l => new Set(l), map: l => new Map(l), all: c => [...c].length,
};
const text = `
const lines = [], show = x => typeof x === "symbol" ? "sym" : typeof x === "bigint" ? x + "n" : Array.isArray(x) ? "[" + x.map(show) + "]" : Object.is(x, -0) ? "-0" : typeof x === "object" && x ? x.constructor?.name ?? "o" : typeof x === "string" ? JSON.stringify(x) : String(x);
const shared = { o: { o: 1 }, s: Symbol("s"), p: new program.Point(1, 2) };
const keys = [
  [], [1], [1, 2, 3], ["a", "b", "c"], [shared.o, shared.s, shared.p], [undefined, null, true, false], [0, -0, NaN, 1.5, -1.5, 2 ** 31, 2 ** 53], [1n, 2n ** 70n], ["a", 1, shared.o, null, 2.5, "a" + 1],
  Array.from({ length: 9 }, (_, i) => i), Array.from({ length: 40 }, (_, i) => "k" + i), Array.from({ length: 300 }, (_, i) => ({ i })), Array.from({ length: 70 }, (_, i) => i % 3 ? i : "x" + i), Array.from({ length: 20 }, (_, i) => i + .5),
];
const values = [i => i, i => "v" + i, i => ({ i }), i => i % 2 ? i : "t" + i, i => undefined, i => i + .25, i => null, i => new program.Point(i, i)];
const makers = []; let m = 0;
for (const l of keys) {
  makers.push(() => new Set(l), () => program.set(l));
  for (const v of l.length === 3 ? values : values.slice(m++ % 5, m % 5 + 2)) makers.push(() => new Map(l.map((k, i) => [k, v(i)])));
  makers.push(() => program.map(l.map((k, i) => [k, i])));
}
makers.push(() => globalThis.kept, () => new (class extends Set { add(x) { return super.add(x); } })([1, 2, 3]), () => new (class extends Map { })([[1, "x"], [2, "y"]]), () => { const s = new Set(); for (let i = 0; i < 64; i++) s.add(i); for (let i = 0; i < 60; i++) s.delete(i); return s; }, () => { const s = new Set([1, 2, 3, 4, 5]); s.delete(1); s.delete(2); s.delete(5); return s; }, () => { const m = new Map(); for (let i = 0; i < 100; i++) m.set(i, i); m.clear(); m.set("after", 1); return m; });
const ways = [c => c, c => c.keys(), c => c.values(), c => c.entries()];
const tell = (name, f) => { let r; try { r = f(); } catch (e) { r = e?.name + e?.message; } lines.push(name + " " + r); };
const changes = [
  (c, x, i) => { },
  (c, x, i) => { c.delete(Array.isArray(x) ? x[0] : x); },
  (c, x, i) => { if (i === 1) program.drop(c, Array.isArray(x) ? x[0] : x); if (i === 2) { let n = 0; for (const y of c.keys()) { if (n++ === 3) { c.delete(y); break; } } } },
  (c, x, i) => { if (i < 3) program.put(c, "added" + i, i); },
  (c, x, i) => { if (i < 3) { const k = Array.isArray(x) ? x[0] : x; c.delete(k); program.put(c, k, "again"); } },
  (c, x, i) => { if (i === 1) c.clear(); },
  (c, x, i) => { if (i === 1) { program.clear(c); for (let k = 0; k < 12; k++) program.put(c, "new" + k, k); } },
  (c, x, i) => { if (i === 2) for (let k = 0; k < 50; k++) program.put(c, k * 3, k); if (i === 4) for (let k = 0; k < 40; k++) c.delete(k * 3); },
  (c, x, i) => { if (i === 0) { for (const y of [...c.keys()]) c.delete(y); program.put(c, 1, 2); } },
  (c, x, i) => { if (i === 1) program.walk(c); if (i === 2) for (const y of c) { if (y === x) break; } },
];
for (const [m, make] of makers.entries()) for (const [w, way] of ways.entries()) {
  for (const [k, change] of changes.entries()) tell(m + " " + w + " " + k, () => { const c = k ? (m % 2 && k > 5 ? make() : make() === globalThis.kept ? new Set(globalThis.kept) : make()) : make(); let r = "", i = 0; for (const x of way(c)) { r += show(x) + " "; change(c, x, i); if (++i > 60) break; } return r.length + ":" + r.slice(0, 48) + c.size; });
  tell(m + " " + w + " parts", () => { const c = make(), it = way(c); let r = "", i = 0; const again = it === c ? c : it; for (const x of again) { r += show(x) + " "; if (++i === 2) break; } r += "| "; for (const x of again) { r += show(x) + " "; if (++i > 9) break; } r += "| "; for (const x of again) r += "left" + i++; return r.slice(0, 60); });
  tell(m + " " + w + " nested", () => { const c = make(); let n = 0; for (const x of way(c)) for (const y of way(c)) { n = n * 3 + (x === y ? 1 : 2) | 0; if (n > 1e8) break; } return n; });
  tell(m + " " + w + " thrown", () => { const c = make(); let r = ""; try { for (const x of way(c)) { r += show(x); if (r.length > 8) throw r; } } catch (e) { r += "!" + (typeof e === "string" ? e : e.name); } return r.slice(0, 40); });
  tell(m + " " + w + " summed", () => { const c = make(); let s = 0; for (let t = 0; t < 12; t++) for (const x of way(c)) s = s * 31 + (typeof x === "number" ? x | 0 : 1) | 0; return s; });
  if (m % 9 === 4) program.collect();
}
tell("grown", () => { const s = new Set([1]); let n = 0; for (const x of s) { if (n++ < 500) s.add(x + 1); } return n + " " + s.size; });
tell("queue", () => { const s = new Set([1, 2, 3]); let n = 0, t = 0; for (const x of s) { s.delete(x); t += x; if (n++ < 400) s.add(x + 3); if (n % 50 === 0) program.collect(); } return n + " " + t + " " + s.size; });
tell("empty then filled", () => { const s = new Set(), it = s.values(); s.add(1); let r = ""; for (const x of it) { r += x; if (x < 5) s.add(x + 1); } s.add(9); for (const x of it) r += "no"; return r; });
tell("own next", () => { const it = new Set([1, 2, 3]).values(); it.next = () => ({ done: true }); let r = ""; for (const x of it) r += x; return r + "."; });
tell("own iterator", () => { const s = new Set([1, 2, 3]); s[Symbol.iterator] = function* () { yield "mine"; }; let r = ""; for (const x of s) r += x; return r; });
tell("next while walking", () => { const it = new Set([1, 2, 3, 4, 5, 6]).values(); let r = ""; for (const x of it) { r += x; r += it.next().value + ","; } return r; });
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
