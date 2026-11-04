// A proxy of a proxy, an heir of the proxy, Reflect.set with the proxy as the receiver, a handler that a function hands out, and super in a class below the proxy.
import { test } from "bun:test";
function fill(object, count) { for (let i = 0; i < count; i++) object.width = i; }
function makeHandler() { return { label: "plain" }; }
function counted(run) {
  const count = { defined: 0, described: 0 };
  Object.prototype.defineProperty = function (target, key, descriptor) { count.defined++; return Reflect.defineProperty(target, key, descriptor); };
  Object.prototype.getOwnPropertyDescriptor = function (target, key) { count.described++; return Reflect.getOwnPropertyDescriptor(target, key); };
  try { run(); } finally { delete Object.prototype.defineProperty; delete Object.prototype.getOwnPropertyDescriptor; }
  return count.defined + " " + count.described;
}
test("a proxy of a proxy", () => {
  const target = { width: 1 }, proxy = new Proxy(new Proxy(target, makeHandler()), makeHandler());
  fill(proxy, 300);
  console.log(counted(() => fill(proxy, 300)), target.width);
});
test("an heir of the proxy", () => {
  const target = { width: 1 }, heir = Object.create(new Proxy(target, makeHandler()));
  console.log(counted(() => fill(heir, 300)), target.width, heir.width, Object.hasOwn(heir, "width"));
});
test("Reflect.set with the proxy as the receiver", () => {
  const target = { width: 1 }, proxy = new Proxy(target, makeHandler());
  for (let i = 0; i < 300; i++) Reflect.set(target, "width", i, proxy);
  console.log(counted(() => { for (let i = 0; i < 300; i++) Reflect.set(target, "width", i, proxy); }), target.width);
});
test("the proxy of another object is the receiver", () => {
  const target = { width: 1 }, other = { width: 5 }, proxy = new Proxy(other, makeHandler());
  console.log(counted(() => { for (let i = 0; i < 300; i++) Reflect.set(target, "width", i, proxy); }), target.width, other.width);
});
test("a name that the target lacks", () => {
  const target = { width: 1 }, proxy = new Proxy(target, makeHandler());
  console.log(counted(() => { for (let i = 0; i < 300; i++) proxy.depth = i; }), target.depth);
});
test("the handler is a proxy", () => {
  let reads = 0;
  const target = { width: 1 }, proxy = new Proxy(target, new Proxy(makeHandler(), { get(handler, key, receiver) { reads++; return Reflect.get(handler, key, receiver); } }));
  console.log(counted(() => fill(proxy, 100)), reads, target.width);
});
test("a revoked proxy", () => {
  const target = { width: 1 }, { proxy, revoke } = Proxy.revocable(target, makeHandler());
  let told = "stored";
  const calls = counted(() => { fill(proxy, 10); revoke(); try { fill(proxy, 10); } catch (error) { told = error.constructor.name; } });
  console.log(calls, told, target.width);
});
