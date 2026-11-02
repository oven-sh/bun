"use strict";
// Delete results: compiled answers as plain.
const o = { a: 1 };
Object.defineProperty(o, "fixed", { value: 1 });
const l = [1, 2, 3];
console.log(
  delete o.a,
  delete o.missing,
  (() => {
    try {
      return delete o.fixed;
    } catch (e) {
      return e.constructor.name;
    }
  })(),
  delete l[1],
  l.length,
  1 in l,
  JSON.stringify(l),
);
