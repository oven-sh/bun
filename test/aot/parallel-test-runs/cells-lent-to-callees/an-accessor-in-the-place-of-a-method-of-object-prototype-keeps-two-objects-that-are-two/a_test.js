// The accessor that a test lays over Object.prototype.toString keeps every object that the name is read off. Two objects made at one place, one behind the other, are two.
import { test, expect } from "bun:test";
const original = Object.prototype.toString;
const kept = [];
let armed = false;
function look(size) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return size.toString === original ? size.w + work : -1;
}
function lend(n) {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return look({ w: n, h: n + 1 }) + work;
}
test("two objects are kept", () => {
  Object.defineProperty(Object.prototype, "toString", { configurable: true, get() { if (armed) kept.push(this); return original; } });
  armed = true;
  const first = lend(JSON.parse("5"));
  const second = lend(JSON.parse("6"));
  armed = false;
  Object.defineProperty(Object.prototype, "toString", { configurable: true, writable: true, value: original });
  console.log("SAID", first, second, kept.length, kept[0] === kept[1], kept[0].w, kept[1].w);
  expect([first, second, kept.length, kept[0] === kept[1], kept[0].w, kept[1].w]).toEqual([7, 8, 2, false, 5, 6]);
});
