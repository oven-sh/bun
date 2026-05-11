import { bench, run } from "../runner.mjs";

const obj = { a: 1, b: 2, c: 3 };
const objDeep = { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7, h: 8 };
const sym = Symbol("test");
const objWithSymbol = { [sym]: 1, a: 2 };

const objs = [
  { f: 50 },
  { f: 50, g: 70 },
  { g: 50, f: 70 },
  { h: 50, f: 70 },
  { z: 50, f: 70 },
  { k: 50, f: 70 },
];

bench("Object.hasOwn - hit", () => {
  return Object.hasOwn(obj, "a");
});

bench("Object.hasOwn - miss", () => {
  return Object.hasOwn(obj, "z");
});

bench("Object.hasOwn - symbol hit", () => {
  return Object.hasOwn(objWithSymbol, sym);
});

bench("Object.hasOwn - symbol miss", () => {
  return Object.hasOwn(objWithSymbol, Symbol("other"));
});

bench("Object.hasOwn - multiple shapes", () => {
  let result = true;
  for (let i = 0; i < objs.length; i++) {
    result = Object.hasOwn(objs[i], "f") && result;
  }
  return result;
});

bench("Object.prototype.hasOwnProperty - hit", () => {
  return obj.hasOwnProperty("a");
});

bench("Object.prototype.hasOwnProperty - miss", () => {
  return obj.hasOwnProperty("z");
});

bench("in operator - hit", () => {
  return "a" in obj;
});

bench("in operator - miss", () => {
  return "z" in obj;
});

await run();
