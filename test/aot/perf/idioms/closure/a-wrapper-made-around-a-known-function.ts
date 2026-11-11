import { nextTurns } from "../host.ts";
// A wrapper made around a function that every call of the maker names: once, counted, with a first argument held.
function counted(inner: (a: number, b: number) => number) {
  let calls = 0;
  return function (a: number, b: number) {
    calls++;
    return inner(a, b) + (calls & 1);
  };
}
function holding(inner: (a: number, b: number) => number, first: number) {
  return function (second: number) {
    return inner(first, second);
  };
}
function add(a: number, b: number) {
  return a + b;
}
function scale(a: number, b: number) {
  return a * b;
}
const countedAdd = counted(add),
  countedScale = counted(scale),
  addThree = holding(add, 3),
  twice = holding(scale, 2);
function bench(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += (countedAdd(i & 7, 1) + countedScale(i & 3, 2) + addThree(i & 1) + twice(i & 15)) & 255;
  return s;
}
let check = 0;
for (let n = nextTurns(0); n > 0; n = nextTurns(check)) check += bench(n) & 1023;
console.log(check);
