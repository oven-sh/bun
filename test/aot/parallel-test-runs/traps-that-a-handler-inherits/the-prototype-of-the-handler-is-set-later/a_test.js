// The handler is a literal. Behind 300 stores it gets another prototype, which has the trap, and then Object.prototype again, on which the trap lies by then.
import { test } from "bun:test";
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
test("another prototype and back", () => {
  let above = 0, atTheTop = 0;
  const target = { width: 1 }, handler = { label: "plain" }, proxy = new Proxy(target, handler), told = [];
  fill(proxy, 300); told.push(above, atTheTop);
  Object.setPrototypeOf(handler, { defineProperty(target, key, descriptor) { above++; return Reflect.defineProperty(target, key, descriptor); } });
  fill(proxy, 100); told.push(above, atTheTop);
  Object.prototype.defineProperty = function (target, key, descriptor) { atTheTop++; return Reflect.defineProperty(target, key, descriptor); };
  try {
    fill(proxy, 50); told.push(above, atTheTop);
    Object.setPrototypeOf(handler, Object.prototype);
    fill(proxy, 25); told.push(above, atTheTop);
    Object.setPrototypeOf(handler, { label: "between" });
    fill(proxy, 12); told.push(above, atTheTop);
  } finally { delete Object.prototype.defineProperty; }
  fill(proxy, 6); told.push(above, atTheTop);
  console.log(told.join(" "), target.width);
});
