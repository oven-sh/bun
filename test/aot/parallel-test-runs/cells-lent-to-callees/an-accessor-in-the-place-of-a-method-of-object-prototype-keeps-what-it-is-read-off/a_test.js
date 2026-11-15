// A test lays an accessor where Object.prototype held a method. Whoever reads that name off an object hands the object to the accessor, which keeps it:
// what it kept is still what it was when another object has been made and handed over at the same place.
import { test, expect } from "bun:test";
const original = Object.prototype.toLocaleString;
let kept = null;
let armed = false;
function look(size) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return size.toLocaleString === original ? size.w + work : -1;
}
function lend(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return look({ w: n, h: n + 1 }) + work;
}
test("what the accessor kept stays as it was", () => {
  Object.defineProperty(Object.prototype, "toLocaleString", { configurable: true, get() { if (armed) kept = this; return original; } });
  armed = true;
  const first = lend(JSON.parse("5"));
  armed = false;
  const second = lend(JSON.parse("700"));
  Object.defineProperty(Object.prototype, "toLocaleString", { configurable: true, writable: true, value: original });
  console.log("SAID", first, second, kept.w, kept.h);
  expect([first, second, kept.w, kept.h]).toEqual([7, 702, 5, 6]);
});
