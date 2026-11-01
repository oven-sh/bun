// A function with parameters on the stack sets a late one to null and then ends in a call, is called in the place of a return, or is entered through the version for calls by value.
"use strict";
function fold(value) {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : 7;
}
let seen = 0;
function use(value) {
  seen = (Math.imul(seen, 31) + fold(value)) | 0;
}
function last(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  use(v11);
  v11 = null; v9 = null; v6 = null;
  return (fold(a) + fold(b) + fold(v0) + fold(v1) + fold(v2) + fold(v3) + fold(v4) + fold(v5) + fold(v6) + fold(v7) + fold(v8) + fold(v9) + fold(v10) + fold(v11)) | 0;
}
function handsOn(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  use(v10);
  v10 = null;
  return last(v11, v9, v8, v7, v6, v5, v4, v3, v2, v1, v0, b, a, v10);
}
function handsOnFewer(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  use(v11);
  v11 = null; v10 = null;
  return short(a, b);
}
function short(a, b) {
  return (fold(a) + fold(b)) | 0;
}
function shortHandsOnMore(a, b) {
  return last(a, b, a, b, a, b, a, b, a, b, a, b, a, b);
}
function again(n, a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  if (n === 0) return (fold(v11) + fold(v10) + fold(a)) | 0;
  const kept = v11;
  v11 = null;
  return again(n - 1, kept, a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10);
}
const table = [last, handsOn, handsOnFewer];
function holds(n, call) {
  const o = [];
  for (let i = 0; i < 14; i++) o.push({ v: n + i });
  const [o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, o10, o11, o12, o13] = o;
  let sum = call(o0, o1, o2, o3, o4, o5, o6, o7, o8, o9, o10, o11, o12, o13);
  sum = (sum + call(o13, o12, o11, o10, o9, o8, o7, o6, o5, o4, o3, o2, o1, o0)) | 0;
  return (sum + o0.v + o1.v + o2.v + o3.v + o4.v + o5.v + o6.v + o7.v + o8.v + o9.v + o10.v + o11.v + o12.v + o13.v) | 0;
}
const ways = {
  "ends in a call with as many": n => holds(n, handsOn),
  "ends in a call with fewer": n => holds(n, handsOnFewer),
  "a short one ends in a call with more": n => holds(n, (a, b) => shortHandsOnMore(a, b)),
  "calls itself in the place of a return": n => holds(n, (...all) => again(9, ...all)),
  "by value, each of three": n => holds(n, (...all) => (table[n % 3](...all) + table[(n + 1) % 3](...all)) | 0),
  "by value with one more than declared": n => holds(n, (...all) => table[n % 3](...all, { extra: 1 }, { extra: 2 })),
  "spread at a direct call": n => holds(n, (...all) => last(...all)),
};
for (const [name, way] of Object.entries(ways)) {
  let hash = 0;
  for (let i = 0; i < 12; i++) hash = (Math.imul(hash, 31) + way(i)) | 0;
  console.log(name, hash >>> 0, seen >>> 0);
}
