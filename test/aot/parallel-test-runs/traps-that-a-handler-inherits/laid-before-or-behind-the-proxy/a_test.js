// The name is laid on Object.prototype in front of the handler, between the handler and the proxy, and behind the proxy.
import { test } from "bun:test";
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
function lay(count) { Object.prototype.defineProperty = function (target, key, descriptor) { count.calls++; return Reflect.defineProperty(target, key, descriptor); }; }
test("in front of the handler", () => {
  const count = { calls: 0 }, target = { width: 1 };
  lay(count);
  try { fill(new Proxy(target, { label: "plain" }), 300); } finally { delete Object.prototype.defineProperty; }
  console.log(count.calls, target.width);
});
test("between the handler and the proxy", () => {
  const count = { calls: 0 }, target = { width: 1 }, handler = { label: "plain" };
  lay(count);
  try { fill(new Proxy(target, handler), 300); } finally { delete Object.prototype.defineProperty; }
  console.log(count.calls, target.width);
});
test("behind the proxy", () => {
  const count = { calls: 0 }, target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
  lay(count);
  try { fill(proxy, 300); } finally { delete Object.prototype.defineProperty; }
  console.log(count.calls, target.width);
});
test("by a definition", () => {
  let calls = 0;
  const target = { width: 1 }, proxy = new Proxy(target, {});
  Object.defineProperty(Object.prototype, "getOwnPropertyDescriptor", { configurable: true, value(target, key) { calls++; return Reflect.getOwnPropertyDescriptor(target, key); } });
  try { fill(proxy, 300); } finally { delete Object.prototype.getOwnPropertyDescriptor; }
  console.log(calls, target.width);
});
test("as a getter", () => {
  let reads = 0, calls = 0;
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
  Object.defineProperty(Object.prototype, "defineProperty", { configurable: true, get() { reads++; return function (target, key, descriptor) { calls++; return Reflect.defineProperty(target, key, descriptor); }; } });
  try { fill(proxy, 300); } finally { delete Object.prototype.defineProperty; }
  console.log(reads, calls, target.width);
});
