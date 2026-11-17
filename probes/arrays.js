// Failing toMatchObject whose pattern names a large array-like AFTER the key that differs. No asymmetric matcher anywhere.
const { expect } = require("bun:test");
function timeOnce(fn) {
  const t0 = performance.now();
  let threw = null;
  try { fn(); } catch (e) { threw = e; }
  const ms = performance.now() - t0;
  return { ms, threw };
}
function bench(label, fn, reps = 5) {
  timeOnce(fn); // warm-up
  const runs = [];
  let last;
  for (let i = 0; i < reps; i++) { last = timeOnce(fn); runs.push(last.ms); }
  runs.sort((a, b) => a - b);
  const med = runs[(reps - 1) >> 1];
  const msg = last.threw ? Bun.stripANSI(String(last.threw.message)) : null;
  const kind = last.threw ? (last.threw.constructor?.name + " len=" + msg.length + " flagged=" + msg.split("\n").filter(l => /^[-+] {3}/.test(l)).length) : "PASSED";
  console.log(label.padEnd(78), med.toFixed(2).padStart(9), "ms  min", runs[0].toFixed(2).padStart(8), " ", kind);
}
for (const n of [1e4, 1e5, 1e6]) {
  const u8 = new Uint8Array(n);
  const u8b = new Uint8Array(n);
  bench(`FAIL first key; Uint8Array(${n}) same object after it`, () => expect({ a: 1, data: u8 }).toMatchObject({ a: 2, data: u8 }));
  bench(`FAIL first key; Uint8Array(${n}) equal, distinct objects`, () => expect({ a: 1, data: u8 }).toMatchObject({ a: 2, data: u8b }));
  bench(`FAIL last key;  Uint8Array(${n}) same object before it`, () => expect({ data: u8, a: 1 }).toMatchObject({ data: u8, a: 2 }));
  bench(`PASS;           Uint8Array(${n}) same object`, () => expect({ a: 1, data: u8 }).toMatchObject({ a: 1, data: u8 }));
  bench(`PASS;           Uint8Array(${n}) equal, distinct objects`, () => expect({ a: 1, data: u8 }).toMatchObject({ a: 1, data: u8b }), 3);
}
{
  const n = 1e6;
  const nums = Array.from({ length: n }, (_, i) => i);
  const f64 = new Float64Array(n);
  const buf = Buffer.alloc(n);
  const strs = Array.from({ length: n }, (_, i) => "s" + (i & 7));
  const objs = Array.from({ length: 2e5 }, (_, i) => ({ id: i }));
  bench(`FAIL first key; Array(1e6 int32) same object after it`, () => expect({ a: 1, data: nums }).toMatchObject({ a: 2, data: nums }));
  bench(`PASS;           Array(1e6 int32) same object`, () => expect({ a: 1, data: nums }).toMatchObject({ a: 1, data: nums }));
  bench(`FAIL first key; Float64Array(1e6) same object after it`, () => expect({ a: 1, data: f64 }).toMatchObject({ a: 2, data: f64 }));
  bench(`FAIL first key; Buffer(1e6) same object after it`, () => expect({ a: 1, data: buf }).toMatchObject({ a: 2, data: buf }));
  bench(`FAIL first key; Array(1e6 strings) same object after it`, () => expect({ a: 1, data: strs }).toMatchObject({ a: 2, data: strs }));
  bench(`FAIL first key; Array(2e5 {id}) same object after it`, () => expect({ a: 1, data: objs }).toMatchObject({ a: 2, data: objs }));
  bench(`toEqual FAIL first key; Uint8Array(1e6) same (control, no 2nd walk)`, () => expect({ a: 1, data: new Uint8Array(0) && f64 }).toEqual({ a: 2, data: f64 }));
}
