// The accessor stands where Object.prototype held hasOwnProperty. Between one reading and the next the stack is used deeply; what was kept last is whole at the end.
import { test, expect } from "bun:test";
const original = Object.prototype.hasOwnProperty;
let kept = null;
function look(o) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return typeof o.hasOwnProperty === "function" ? o.w + work : -1;
}
function deep(n) {
  return n === 0 ? 0 : 1 + deep(n - 1) + [n, n, n, n].length;
}
function lend(x) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return look({ w: x, h: x + 1 }) + work;
}
test("what was kept last is whole", () => {
  Object.defineProperty(Object.prototype, "hasOwnProperty", { configurable: true, get() { kept = this; return original; } });
  let total = 0;
  for (let turn = 0; turn < 300; turn++) {
    total += lend(turn);
    deep(50);
  }
  const seen = kept;
  Object.defineProperty(Object.prototype, "hasOwnProperty", { configurable: true, writable: true, value: original });
  console.log("SAID", total, seen.w, seen.h);
  expect([total, seen.w, seen.h]).toEqual([45450, 299, 300]);
});
