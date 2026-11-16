// Iterations that first use a lazily made constant (a built-in, a module's object, list, regular expression or closure) and then meet a value of another kind, run unknown code or throw.
"use strict";
const table = [3, 1, 4, 1, 5, 9, 2, 6];
const names = { a: 1, b: 2, c: { d: 4 } };
const pattern = /[a-c]+(\d)?/;
const composed = new RegExp("[" + "x-z" + "]");
const twice = (x) => x * 2;
const set = new Set([1, 2, 3]);
class O {
  constructor(v) { this.value = v; this.count = 0; }
  get(i) { return this.value + i; }
}
const log = [];
globalThis.note = (x, o) => {
  log.push(String(x));
  if (x > 40) o.value = "s" + x;
  if (x === 9) Object.defineProperty(o, "count", { get() { return 7; }, set(v) { log.push("set" + v); }, configurable: true });
};
const loops = {
  code(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { s += String.fromCharCode(97 + (i & 7)).length + o.value; o.count++; s += list[i % list.length]; } return s; },
  math(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { s += i > 6 ? Math.max(i, 3) : 0; s += o.get(i); if (i % 5 === 4) globalThis.note(i, o); } return s; },
  table(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { s += table[i & 7]; o.count += i; if (i % 4 === 3) globalThis.note(o.count, o); o.value = i; } return s; },
  names(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { if (i & 1) s += names.c.d; s += o.value; o.count++; } return s; },
  pattern(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { s += pattern.test("b" + i) ? 1 : 0; s += list[i % list.length]; if (i % 6 === 5) globalThis.note(i, o); } return s; },
  composed(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { if (i > 3) s += composed.test("y" + i) ? 1 : 0; s += o.get(i); } return s; },
  twice(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { s += twice(i); try { if (i % 6 === 5) throw new Error("t" + i); s += o.value; } catch (e) { s += e.message.length; } } return s; },
  set(o, list, n) { let s = 0; for (let i = 0; i < n; i++) { s += set.has(i & 7) ? 1 : 0; o.count += list.length; s += list[i]; } return s; },
  json(o, list, n) { let s = ""; for (let i = 0; i < n; i++) { s += JSON.stringify([i]).length + Number.isInteger(i) + o.value; if (i === 11) globalThis.note(50, o); } return s; },
};
globalThis.kept = loops;
for (const name of Object.keys(loops)) {
  const objects = [new O(1), new O(2.5), { value: "v", count: 1, get(i) { return "g" + i; } }, new O(undefined), Object.freeze(new O(4)), new O(3n)];
  for (const o of objects) for (const list of [[1, 2, 3], [1.5, , 3], ["a", 2], [], Object.assign([1, 2], { x: 1 })]) {
    let s;
    try { s = globalThis.kept[name](o, list, 14); } catch (e) { s = e.constructor.name; }
    console.log(name, String(s), o.count, String(o.value), log.length);
  }
}
console.log(log.join());
