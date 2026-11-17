// Elements, captured variables and fields of any kind in the same sums: holes, strings, undefined, accessors, views, frozen arrays.
"use strict";
const show = v => (Object.is(v, -0) ? "-0" : typeof v === "string" ? JSON.stringify(v) : String(v));
const make = (xs, step) => {
  let last = 0;
  return {
    add(i) {
      xs[i] += step;
      last = xs[i] + last;
      return last;
    },
    at(i) {
      return xs[i] + step;
    },
  };
};
class Box {
  constructor(v, d) {
    this.v = v;
    this.d = d;
  }
  up(i) {
    this.v[i] += this.d;
    return this.v[i] + this.d;
  }
}
const arrays = [
  () => [0.5, 1.5, 2.5],
  () => [1, 2, 3],
  () => [1, , 3],
  () => [NaN, -0, 0],
  () => ["a", 1, null],
  () => [undefined, true, 1.5],
  () => new Float64Array([0.5, -0, 2]),
  () => new Uint8Array([250, 255, 1]),
  () => Object.freeze([1, 2.5, 3]),
  () => Object.defineProperty([1, 2, 3], 1, { get: () => 7.5, set(x) {} }),
  () => Object.setPrototypeOf([1, , 3], { 1: 4.5 }),
];
const steps = [0.5, 1, -0, NaN, "s", undefined, null, 2n, { valueOf: () => 3 }];
for (const array of arrays) {
  for (const step of steps) {
    let line = "";
    for (const i of [0, 1, 2, 3, -1]) {
      for (const run of [() => make(array(), step).add(i), () => make(array(), step).at(i), () => new Box(array(), step).up(i)]) {
        try {
          line += show(run()) + " ";
        } catch (error) {
          line += error.constructor.name + " ";
        }
      }
    }
    console.log(line);
  }
}
