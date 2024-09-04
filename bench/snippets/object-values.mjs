const obj = {
  a: 1,
  b: 2,
  c: 3,
  d: 4,
  e: 5,
  f: 6,
  g: 7,
  h: 8,
  i: 9,
  j: 10,
  k: 11,
  l: 12,
  m: 13,
  n: 14,
  o: 15,
  p: 16,
  q: 17,
  r: 18,
  s: 19,
  t: 20,
  u: 21,
  v: 22,
  w: 23,
};

import { bench, run } from "./runner.mjs";

var val = 0;
bench("Object.values(literal)", () => {
  obj.a = val++;
  Object.values(obj);
});
const objWithMethods = {
  ...obj,
  toString() {},
  valueOf() {},
  [Symbol.iterator]() {},
  [Symbol.toPrimitive]() {},
};
var val = 0;
bench("Object.values(literal with methods)", () => {
  objWithMethods.a = val++;
  Object.values(objWithMethods);
});

await run();
