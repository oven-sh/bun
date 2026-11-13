"use strict";
// Splices whose result nobody reads: lists of every kind, holes, frozen and extended lists, long lists from the front, items that the list's kind does not hold.
let seen = 0;
const makers = [
  () => [1, 2, 3, 4, 5, 6], () => [1.5, 2.5, -0, NaN, 4], () => ["a", "b", "c", "d", "e"], () => [1, , 3, , 5], () => [1.5, , 2.5, 3], () => [{ k: 1 }, null, undefined, "x"],
  () => Array.from({ length: 150 }, (_, i) => i), () => Array.from({ length: 150 }, (_, i) => "s" + i), () => { const list = [1, 2, 3]; list.length = 9; return list; }, () => [],
  () => { const list = ["a", "b", "c", "d"]; list.shift(); list.shift(); return list; }, () => Object.freeze([1, 2, 3]), () => Object.seal([1, 2, 3, 4]),
  () => { const list = [1, 2, 3, 4]; list.name = "own"; return list; }, () => { const list = [1, 2, 3, 4]; Object.defineProperty(list, "length", { writable: false }); return list; },
  () => new (class Sub extends Array {})(1, 2, 3, 4), () => { const list = [1, 2, 3, 4]; list.constructor = { [Symbol.species]: function () { seen++; return {}; } }; return list; },
  () => Object.setPrototypeOf([1, , 3], { __proto__: Array.prototype, 1: "below" }), () => { const list = [1, 2]; list[4000] = 3; return list; },
];
const works = [
  list => { for (let i = 0; i < 4; i++) list.splice(i, 1, i, -i); }, list => { for (let i = 0; i < 4; i++) list.splice(i, 1); }, list => { for (let i = 0; i < 6; i++) list.splice(0, 0, i); },
  list => { for (let i = 0; i < 3; i++) list.splice(-2, 1, "w"); }, list => { for (let i = 0; i < 3; i++) list.splice(list.length, 0, i + 0.5, i); }, list => { for (let i = 0; i < 3; i++) list.splice(1, 100); },
  list => { for (let i = 0; i < 300; i++) list.splice(0, 0, i); }, list => { for (let i = 0; i < 5; i++) list.splice(i, 2, list.length, list[0], NaN); }, list => { for (let i = 0; i < 3; i++) list.splice(i, -1, { i }); },
  list => { for (let i = 0; i < 40; i++) { list.splice(list.length >> 1, 0, i); if (i & 1) list.splice(0, 1); } }, list => { for (let i = 0; i < 3; i++) list.splice("1", 1.9, i); },
];
const show = list => list.length + ":" + Array.from({ length: Math.min(list.length, 320) }, (_, i) => i in list ? (Object.is(list[i], -0) ? "-0" : JSON.stringify(list[i]) ?? "u") : "_").join(",");
for (let pass = 0; pass < 3; pass++) for (const work of works) for (const make of makers) {
  const list = make();
  let failed = "";
  try { work(list); } catch (error) { failed = " " + error.name; }
  console.log(show(list) + failed, seen);
}
