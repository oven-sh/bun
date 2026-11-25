// Maps and Sets that are exactly full: keys that they have are stored again, keys that they lack make them larger, values of another kind widen them, and walks go on beside it.
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
const program = { collect: () => globalThis.Bun?.gc?.(true), put: (m, k, v) => m.set(k, v), objects: Array.from({ length: 300 }, (_, i) => ({ i })) };
const text = `
const lines = [], objects = program.objects;
const kinds = { integers: i => i, negative: i => -i - 1, doubles: i => i + 0.25, objects: i => objects[i], strings: i => "key" + i, ropes: i => "rope " + i + "/" + i, mixed: i => i % 3 ? i % 3 === 1 ? "m" + i : objects[i] : i, special: i => [undefined, null, true, false, NaN, -0][i] ?? i };
const show = v => Object.is(v, -0) ? "-0" : typeof v === "object" && v ? "o" + v.i : String(v);
for (const [kn, key] of Object.entries(kinds)) for (const n of [4, 8, 9, 12, 16, 18, 24, 32, 36, 48, 64, 72, 96, 128, 144, 192, 254, 256]) {
  const m = new Map(), s = new Set(); let t = 0;
  for (let i = 0; i < n; i++) { m.set(key(i), i); s.add(key(i)); }
  for (let turn = 0; turn < 4; turn++) for (let i = 0; i < n; i++) { if (i & 1) m.set(key(i), i * turn); else program.put(m, key(i), objects[i]); s.add(key(i)); t += m.get(key(i)) === i * turn ? 1 : 0; }
  const walk = m.entries(); walk.next(); let steps = 0;
  for (let i = 0; i < n; i++) { m.set(key(i), i % 4 === 0 ? 1.5 : i % 4 === 1 ? "v" : undefined); if (i % 5 === 0) steps += walk.next().done ? 0 : 1; }
  for (let i = n; i < n + 3; i++) { m.set(key(i), i); m.set(key(0), "again" + i); s.add(key(i)); s.add(key(1)); if (i === n && n < 40) program.collect(); }
  const size = m.size; m.delete(key(2)); m.set(key(2), "back"); s.delete(key(1)); s.add(key(1));
  lines.push(kn + " " + n + " " + t + " " + steps + " " + size + " " + m.size + " " + s.size + " " + [...m].slice(-5).map(e => e.map(show).join(":")).join(" ") + " " + [...s].slice(-3).map(show).join(" ") + " " + [...m.values()].slice(0, 5).map(show).join(" ") + " " + [...walk].length);
}
return lines.join("\\n");`;
for (let turn = 0; turn < 2; turn++) console.log(new Function("program", hidden(text))(program));
