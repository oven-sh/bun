// so it can run in environments without node module resolution
import { bench, run } from "../runner.mjs";

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
  x: 24,
  y: 25,
  z: 26,
};

bench("Object.entries(26 keys)", () => {
  var k;
  for (let [key, value] of Object.entries(obj)) {
    value = key;
  }
  return k;
});

bench("Object.keys(26 keys)", () => {
  var k;
  for (let [key, value] of Object.keys(obj)) {
    value = key;
  }
  return k;
});

bench("Object.entries(2 keys)", () => {
  var k;
  for (let [key, value] of Object.entries({ a: 1, b: 2 })) {
    value = key;
  }
  return k;
});

bench("Object.keys(2 keys)", () => {
  var k;
  for (let item of Object.keys({ a: 1, b: 2 })) {
  }
  return k;
});

await run();
