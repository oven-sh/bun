// STATISTIC: TableCapacitiesReserved >= 4
// A loop over a short list reserves room for an empty collection: the table of the first entry has it, whatever its keys and values are.
"use strict";
function counted(list) {
  const m = new Map();
  for (const k of list) m.set(k, (m.get(k) ?? 0) + 1);
  return m;
}
function placed(list) {
  const m = new Map();
  for (const k of list) m.set(k, m);
  return m;
}
function halves(list) {
  const m = new Map();
  for (const k of list) m.set(k, m.size / 2);
  return m;
}
function seen(list) {
  const s = new Set();
  for (const k of list) s.add(k);
  return s;
}
const show = c => [...c].map(e => (Array.isArray(e) ? e.map(v => (v === Object(v) ? "object" : Object.is(v, -0) ? "-0" : String(v))).join("=") : e === Object(e) ? "object" : String(e))).join(" ");
const sources = [k => k, k => "k" + k, k => k / 2, k => (k & 1 ? "a" : k), k => [k][0] - 3, k => (k % 3 ? null : undefined), k => ({ k }), k => BigInt(k)];
let total = 0;
for (let length = 0; length <= 12; length++) {
  for (const source of sources) {
    const list = Array.from({ length }, (_, k) => source(k % 9));
    const line = [counted(list), placed(list), halves(list), seen(list)].map(c => c.size + ":" + show(c));
    if (length > 3 && length < 10) console.log(line.join(" | "));
    total += line.join().length;
  }
}
console.log(total);
// The table grows past its room, loses entries and is walked while it grows.
for (let turn = 0; turn < 300; turn++) {
  const m = counted(["x", "y", "z", "x", "w", turn]);
  const its = m[Symbol.iterator]();
  its.next();
  for (let k = 0; k < 20; k++) m.set("more" + k, k);
  m.delete("y");
  m.delete("z");
  if (turn % 100 === 7) console.log(show(m), [...its].length);
  m.clear();
  m.set(turn, 1);
  total += m.size;
}
console.log(total);
