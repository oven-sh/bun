// A store into a captured variable that only some ways of a copied function do is undone where the iteration restarts behind their join.
const kept = [];
const show = (v) => Object.is(v, -0) ? "-0" : JSON.stringify(v) ?? String(v);
const lines = [];
function scan(values, others) {
  let max = -1, hits = 0;
  const note = (x) => { if (x > max) { max = x; hits++; } };
  kept.push(note, () => [max, hits]);
  let n = 0;
  for (let i = 0; i < values.length; i++) { note(values[i]); n += others[i]; }
  return [n, max, hits];
}
function cell(value) {
  const c = { get() { return value; }, set(x) { if (x !== value) value = x; else kept.length++; } };
  kept.push(c);
  return c;
}
function stores(c, d, others) { let n = 0; for (let i = 0; i < others.length; i++) { c.set(i & 3); n += others[i]; d.set(i >> 2); n += c.get() - d.get(); } return n; }
function either(values, others) {
  let low = 100, high = -100, last = "none";
  const note = (x) => { if (x < 0) { low = Math.min(low, x); last = "low"; } else if (x > 9) { high = x; last = "high"; } };
  kept.push(note, () => [low, high, last]);
  let t = 0;
  for (let i = 0; i < values.length; i++) { note(values[i]); t += others[i].v; note(others[i].v); }
  return [t, low, high, last];
}
const attempt = (f) => { try { return show(f()); } catch (e) { return e.constructor.name + ": " + e.message; } };
const numbers = [3, 1, 4, 1, 5, 9, 2, 6, 5, 35];
const broken = (at, value) => numbers.map((x, i) => i === at ? value : x);
for (let turn = 0; turn < 3; turn++) {
  lines.push(attempt(() => scan(numbers, numbers)));
  for (const value of ["s", 0.5, NaN, -0, undefined, null, 2 ** 31, 10n, {}, { valueOf() { return kept.at(-1)()[1]; } }]) {
    for (const at of [0, 1, 4, 9]) {
      lines.push(attempt(() => scan(numbers, broken(at, value))), show(kept.at(-1)()));
      const c = cell(7), d = cell(8);
      lines.push(attempt(() => stores(c, d, broken(at, value))), show([c.get(), d.get()]));
      lines.push(attempt(() => stores(c, c, broken(at, value))), show(c.get()));
      const rows = numbers.map((x, i) => i === at ? { w: 1, v: value } : { v: x - 4 });
      lines.push(attempt(() => either(numbers.map((x) => x - 5), rows)), show(kept.at(-1)()));
      rows[at] = value;
      lines.push(attempt(() => either(numbers, rows)), show(kept.at(-1)()));
    }
  }
}
lines.push(kept.length);
console.log(lines.join("\n"));
