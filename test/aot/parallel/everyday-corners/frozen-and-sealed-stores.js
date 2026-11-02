"use strict";
// Frozen and sealed stores: compiled answers as plain.
const f = Object.freeze({ a: 1, inner: { b: 1 } }),
  s = Object.seal({ a: 1 });
const t = g => {
  try {
    g();
    return "ok";
  } catch (e) {
    return e.constructor.name;
  }
};
console.log(
  t(() => {
    f.a = 2;
  }),
  t(() => {
    f.inner.b = 2;
  }),
  t(() => {
    f.n = 1;
  }),
  t(() => {
    s.a = 2;
  }),
  t(() => {
    s.n = 1;
  }),
  t(() => {
    delete s.a;
  }),
  JSON.stringify([f, s]),
);
