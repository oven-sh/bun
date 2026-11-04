// The name comes and goes five times, and the stores in between go one way and the other.
import { test } from "bun:test";
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
test("five rounds", () => {
  let calls = 0;
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" }), told = [];
  for (let round = 0; round < 5; round++) {
    Object.prototype.defineProperty = function (target, key, descriptor) { calls++; return Reflect.defineProperty(target, key, descriptor); };
    try { fill(proxy, 100); } finally { delete Object.prototype.defineProperty; }
    told.push(calls);
    fill(proxy, 100);
    told.push(calls);
  }
  console.log(told.join(" "), target.width);
});
test("undefined and null lie there, and then a function", () => {
  let calls = 0;
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" }), told = [];
  try {
    Object.prototype.defineProperty = undefined;
    fill(proxy, 100); told.push(calls, target.width);
    Object.prototype.defineProperty = null;
    fill(proxy, 50); told.push(calls, target.width);
    Object.prototype.defineProperty = function (target, key, descriptor) { calls++; return Reflect.defineProperty(target, key, descriptor); };
    fill(proxy, 25); told.push(calls, target.width);
  } finally { delete Object.prototype.defineProperty; }
  console.log(told.join(" "));
});
test("what lies there cannot be called", () => {
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
  let told = "stored";
  Object.prototype.defineProperty = 7;
  try { fill(proxy, 3); } catch (error) { told = error.constructor.name; } finally { delete Object.prototype.defineProperty; }
  console.log(told, target.width);
});
test("the trap refuses", () => {
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
  let told = "stored";
  Object.prototype.defineProperty = function () { return false; };
  try { fill(proxy, 3); } catch (error) { told = error.constructor.name; } finally { delete Object.prototype.defineProperty; }
  console.log(told, target.width, Reflect.set(proxy, "width", 9), target.width);
});
