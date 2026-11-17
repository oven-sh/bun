// Matcher-free failing toMatchObject: typical shapes, distinct-but-equal values after the key that differs.
const { expect } = require("bun:test");
function timeOnce(fn) { const t0 = performance.now(); let threw = null; try { fn(); } catch (e) { threw = e; } return { ms: performance.now() - t0, threw }; }
function bench(label, fn, reps = 9) {
  timeOnce(fn); timeOnce(fn);
  const runs = []; let last;
  for (let i = 0; i < reps; i++) { last = timeOnce(fn); runs.push(last.ms); }
  runs.sort((a, b) => a - b);
  const msg = last.threw ? Bun.stripANSI(String(last.threw.message)) : null;
  console.log(label.padEnd(86), runs[(reps - 1) >> 1].toFixed(3).padStart(10), "ms  min", runs[0].toFixed(3).padStart(9), " ", last.threw ? (last.threw.constructor?.name + " len=" + msg.length) : "PASSED");
}
const rec = i => ({ id: i, name: "user" + i, tags: ["a", "b", "c"], owner: { id: i % 7, name: "o" + (i % 7), address: { city: "x", zip: "12345" } }, active: true, score: i * 1.5 });
for (const n of [1, 10, 100, 1000, 5000, 20000]) {
  const recv = { status: 500, items: Array.from({ length: n }, (_, i) => rec(i)) };
  const patFail = { status: 200, items: Array.from({ length: n }, (_, i) => rec(i)) };
  const patPass = { status: 500, items: Array.from({ length: n }, (_, i) => rec(i)) };
  bench(`FAIL first key; ${n} records after it (distinct, equal, no matcher)`, () => expect(recv).toMatchObject(patFail));
  bench(`PASS;           ${n} records (distinct, equal, no matcher)`, () => expect(recv).toMatchObject(patPass));
}
{
  // A flat config-like object: 40 keys, 3 nested objects.
  const mk = s => ({ status: s, a: { x: 1, y: 2, z: { q: [1, 2, 3] } }, b: { list: [{ k: 1 }, { k: 2 }] }, c: "str", d: 4, e: null, f: { g: { h: { i: 1 } } } });
  const r = mk(500), pf = mk(200), pp = mk(500);
  bench(`FAIL first key; small nested object (no matcher)`, () => expect(r).toMatchObject(pf), 201);
  bench(`PASS;           small nested object (no matcher)`, () => expect(r).toMatchObject(pp), 201);
}
