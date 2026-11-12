// A generator with parameters on the stack is resumed by another caller each time: a callback, another generator, native code, a promise's job. Between two of the steps it sets a late parameter to null.
function fold(value) {
  return typeof value === "number" ? value | 0 : value === null ? 3 : value === undefined ? 5 : 7;
}
function* late(a, b, v0, v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11) {
  yield fold(a) + 1;
  v11 = null;
  yield fold(b) + 2;
  v10 = null; v9 = null;
  yield fold(v0) + 3;
  v8 = null; v7 = null; v6 = null;
  yield fold(v1) + 4;
  v5 = null; v4 = null;
  yield fold(v2) + fold(v11) + fold(v10) + fold(v4);
  return 9;
}
const make = n => { const o = i => ({ v: n + i }); return late(o(0), o(1), o(2), o(3), o(4), o(5), o(6), o(7), o(8), o(9), o(10), o(11), o(12), o(13)); };
function holding(n, step) {
  const o0 = { v: n + 1 }, o1 = { v: n + 2 }, o2 = { v: n + 3 }, o3 = { v: n + 4 }, o4 = { v: n + 5 }, o5 = { v: n + 6 }, o6 = { v: n + 7 }, o7 = { v: n + 8 };
  const o8 = { v: n + 9 }, o9 = { v: n + 10 }, o10 = { v: n + 11 }, o11 = { v: n + 12 };
  const value = step();
  return (value + o0.v + o1.v + o2.v + o3.v + o4.v + o5.v + o6.v + o7.v + o8.v + o9.v + o10.v + o11.v) | 0;
}
function* outer(inner) {
  const o0 = { v: 1 }, o1 = { v: 2 }, o2 = { v: 3 }, o3 = { v: 4 }, o4 = { v: 5 }, o5 = { v: 6 };
  const ended = yield* inner;
  yield (ended + o0.v + o1.v + o2.v + o3.v + o4.v + o5.v) | 0;
}
let hash = 0;
const mix = value => void (hash = (Math.imul(hash, 31) + value) | 0);
for (let n = 0; n < 8; n++) {
  const steps = make(n);
  mix(holding(n, () => steps.next().value));
  mix([0].map(() => steps.next().value)[0]);
  mix(holding(n, () => Reflect.apply(steps.next, steps, []).value));
  mix(await Promise.resolve().then(() => steps.next().value));
  mix(await new Promise(resolve => setTimeout(() => resolve(steps.next().value), 0)));
  mix(holding(n, () => steps.next().value));
}
console.log("another caller each time", hash >>> 0);
for (let n = 0; n < 8; n++) for (const value of outer(make(n))) mix(value);
console.log("through yield*", hash >>> 0);
for (let n = 0; n < 8; n++) mix(holding(n, () => [...make(n)].reduce((x, y) => (x + y) | 0, 0)));
console.log("a spread", hash >>> 0);
for (let n = 0; n < 8; n++) mix(holding(n, () => Array.from(make(n)).length + Math.max(...make(n))));
console.log("Array.from and a spread call", hash >>> 0);
for (let n = 0; n < 8; n++) { const [x, y, z] = make(n); mix(x + y + z); }
console.log("destructuring, which ends it early", hash >>> 0);
for (let n = 0; n < 8; n++) mix(new Map([...make(n)].map((value, index) => [index, value])).size + new Set(make(n)).size);
console.log("a Set takes it", hash >>> 0);
