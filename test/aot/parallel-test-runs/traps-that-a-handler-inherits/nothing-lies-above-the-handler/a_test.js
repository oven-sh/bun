// The handler has no prototype, so what lies on Object.prototype is none of its traps.
import { test } from "bun:test";
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
function run(what, handler) {
  let calls = 0;
  const target = { width: 1 }, proxy = new Proxy(target, handler);
  fill(proxy, 300);
  Object.prototype.defineProperty = function (target, key, descriptor) { calls++; return Reflect.defineProperty(target, key, descriptor); };
  Object.prototype.getOwnPropertyDescriptor = function (target, key) { calls++; return Reflect.getOwnPropertyDescriptor(target, key); };
  try { fill(proxy, 300); } finally { delete Object.prototype.defineProperty; delete Object.prototype.getOwnPropertyDescriptor; }
  console.log(what, calls, target.width);
}
test("Object.create(null)", () => run("Object.create(null)", Object.create(null)));
test("a literal with a null prototype", () => run("a literal with a null prototype", { __proto__: null, label: "plain" }));
test("a literal whose prototype is taken away", () => run("a literal whose prototype is taken away", Object.setPrototypeOf({ label: "plain" }, null)));
