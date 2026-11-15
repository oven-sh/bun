// Maps and Sets of every size by numbers, objects, strings and other keys: filled, stored again, read, asked, emptied and walked by evaluated text, with compiled functions in between.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const program = { collect: () => globalThis.Bun?.gc?.(true), put: (m, k, v) => m.set(k, v), add: (s, k) => s.add(k), get: (m, k) => m.get(k), drop: (m, k) => m.delete(k), objects: Array.from({ length: 700 }, (_, i) => i % 3 ? { i } : i % 2 ? [i] : () => i) };
const text = `
const lines = [], objects = program.objects, symbols = [Symbol("a"), Symbol.iterator, Symbol.for("c")], big = [10n, 2n ** 70n, -1n];
const show = v => Object.is(v, -0) ? "-0" : Array.isArray(v) ? "[" + v.map(show).join() + "]" : typeof v === "string" ? JSON.stringify(v) : typeof v === "bigint" ? v + "n" : typeof v === "object" && v ? "{" + Object.keys(v).join() + "}" : typeof v === "function" ? "f" + v() : String(v);
const digest = l => { let h = 0; for (const t of l.map(show).join(" ")) h = h * 31 + t.charCodeAt(0) | 0; return l.length + ":" + h; };
const keys = {
  small: i => i, negative: i => -i, spread: i => i * 65537 | 0, high: i => 2147483647 - i, low: i => -2147483648 + i, sums: i => i + 0.5, wide: i => i * 1e10, halves: i => i / 2, zeros: i => [0, -0, 0.0, -0.0, 1.0, 1][i % 6] + (i > 20 ? i : 0),
  odd: i => [NaN, undefined, null, true, false, Infinity, -Infinity, 2 ** 31, -(2 ** 31) - 1, 0 / 0][i % 10], objects: i => objects[i % 700], strings: i => "k" + i, ropes: i => "key " + (i + "/" + i), parts: i => ("xx" + i + "yy").slice(1, -1), mixed: i => i % 4 === 0 ? i : i % 4 === 1 ? "s" + i : i % 4 === 2 ? objects[i % 700] : i + 0.25,
  symbols: i => i < 3 ? symbols[i] : i, bigs: i => i % 5 ? i : i < 3 ? big[i] : BigInt(i) * 3n, texts: i => i % 2 ? String(i) : i,
};
const values = { integers: i => i, doubles: i => i / 3, objects: i => objects[i % 7], none: () => undefined, turning: i => i < 5 ? objects[i] : i === 5 ? 1.5 : i, strings: i => "v" + i, nulls: i => i % 2 ? null : true };
for (const [kn, key] of Object.entries(keys)) {
  for (const n of [1, 3, 4, 5, 8, 9, 16, 30, 254, 255, 256, 600]) {
    const r = [], s = new Set(), seen = [];
    for (const [vn, value] of Object.entries(values)) {
      const m = new Map();
      for (let i = 0; i < n; i++) m.set(key(i), value(i));
      for (let i = 0; i < n; i++) { if (i % 3) m.set(key(i), value(i + 1)); else program.put(m, key(i), value(i + 2)); }
      let found = 0; for (let i = 0; i < n + 5; i++) { if (m.has(key(i))) found++; const v = m.get(key(i)); if (v === program.get(m, key(i)) || v !== v) found++; }
      for (let i = 0; i < n; i += 2) { if (m.delete(key(i))) found += 1000; if (i % 5 === 0 && program.drop(m, key(i + 1))) found += 1000; }
      const size = m.size; for (let i = 0; i < n; i += 4) m.set(key(i), value(i)); let c = 0; for (const [a, b] of m) { if (c++ < n) m.set(a, value(c)); if (c === 3) m.set("late", 1); if (c === 5) m.delete(a); if (c === 7 && n < 20) program.collect(); }
      r.push(found, size, m.size, digest([...m]));
      if (n === 30 && vn === "objects") m.clear(), m.set(key(1), 1), r.push([...m]);
    }
    for (let i = 0; i < n; i++) { s.add(key(i)); if (i % 2) s.add(key(i >> 1)); else program.add(s, key(i >> 1)); }
    let t = 0; s.forEach(k => { if (t++ < 20) { s.add(key(t)); if (t % 3 === 0) s.delete(key(t)); if (s.has(key(t + 1))) t++; } });
    for (let i = 0; i < n; i++) { if (i % 2) s.delete(key(i)); else s.add(key(n + i)); }
    lines.push(kn + " " + n + " " + show(r) + " " + t + " " + s.size + " " + digest([...s]));
  }
}
const m = new Map([[1, "one"], [1.0, "again"], ["1", "text"], [true, 1]]), w = new Map(m); m.set(-0, "zero"); w.set(0, "nought"); lines.push(show([...m]), show([...w]), m.get(0), w.get(-0), m.has(-0), m.get("1"), m.get(1), m.get(1.0));
const chained = new Map().set(1, 1).set(2, 2).set(1, 3); lines.push(show([...chained]), new Set().add(1).add(1).add(2).size);
for (const o of [{}, null, new Set, new WeakMap]) try { Map.prototype.set.call(o, 1, 2); lines.push("set"); } catch (e) { lines.push(e.name); }
const it = chained.entries(); it.next(); chained.delete(1); chained.set(3, 3); chained.set(1, 4); lines.push(show([...it]));
class Sub extends Map { set(k, v) { lines.push("sub " + k); return super.set(k, v); } } const sub = new Sub([[1, 2]]); sub.set(1, 5); lines.push(sub.get(1), sub.size);
const large = new Map(); for (let i = 0; i < 70000; i++) large.set(i * 3, i); for (let i = 0; i < 70000; i += 7) large.set(i * 3, -i); let sum = 0; for (let i = 0; i < 70000; i++) sum += large.get(i * 3) + (large.has(i * 3 + 1) ? 1 : 0); lines.push(sum, large.size);
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
