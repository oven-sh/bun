// A built-in method is called on an array in some calls and on a typed array in others.
"use strict";
const out = [];
function list(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push((i * 37) & 63);
  return a;
}
function total(h, t) {
  return h.reduce((a, x) => (a + x) | 0, t);
}
function where(h, t) {
  return h.indexOf(t) * 100 + h.lastIndexOf(t) + (h.includes(t + 1) ? 0.5 : 0);
}
function next(h, t) {
  return h.map(x => (x + t) & 31);
}
function walk(h, t) {
  let s = t;
  h.forEach((x, i) => {
    s = (s + x * i) | 0;
  });
  return s + (h.every(x => x >= 0) ? 1 : 2) + (h.some(x => x > 60) ? 10 : 20) + h.findIndex(x => x === 5);
}
function change(h, t) {
  h.fill(t & 63, 1, 3);
  h.reverse();
  return h.slice(1, 5).join("-") + h.at(-1);
}
const holders = [list(16), new Int32Array(list(16)), list(5), new Int32Array(list(7))];
for (let round = 0; round < 8; round++) {
  for (const h of holders) {
    const mapped = next(h, round);
    out.push([total(h, round), where(h, round), mapped.constructor.name, Array.from(mapped).join(), walk(h, round), change(h, round)].join(" "));
    if (round === 5 && Array.isArray(h)) {
      h.length = 3;
      h.push(7);
    }
  }
}
class Own extends Int32Array {
  indexOf() {
    return 41;
  }
}
const renamed = new Int32Array(list(6));
renamed.map = f => [f(1), f(2)];
const moved = new Int32Array(list(6));
structuredClone(moved.buffer, { transfer: [moved.buffer] });
const others = [new Own(4), renamed, moved, Object.freeze(list(6)), [1, , 3], [1.5, -0, NaN], new Float64Array([1.5, -0, NaN]), { reduce: () => 1, indexOf: () => 2, lastIndexOf: () => 3, includes: () => true }, "text", null];
for (const other of others) {
  for (const f of [total, where, next, walk, change]) {
    try {
      out.push(String(f(other, 2)));
    } catch (e) {
      out.push(e.constructor.name);
    }
  }
}
for (const h of holders) out.push(h.constructor.name + " " + Array.from(h).join());
for (const line of out) console.log(line);
