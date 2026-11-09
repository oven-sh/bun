// The target, the handler and the proxy pass through code that the build has not seen, and such code makes the stores.
import { test } from "bun:test";
const hide = (0, eval)("(x) => x");
const fillUnseen = (0, eval)("(proxy, count) => { for (let i = 0; i < count; i++) proxy.width = i; }");
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
function counted(run) {
  let calls = 0;
  Object.prototype.defineProperty = function (target, key, descriptor) { calls++; return Reflect.defineProperty(target, key, descriptor); };
  try { run(); } finally { delete Object.prototype.defineProperty; }
  return calls;
}
test("the handler has been out of sight", () => {
  const target = { width: 1 }, proxy = new Proxy(target, hide({ label: "plain" }));
  fill(proxy, 300);
  console.log(counted(() => fill(proxy, 300)), target.width);
});
test("the target has been out of sight", () => {
  const target = hide({ width: 1 }), proxy = new Proxy(target, { label: "plain" });
  fill(proxy, 300);
  console.log(counted(() => fill(proxy, 300)), target.width);
});
test("the proxy has been out of sight", () => {
  const target = { width: 1 }, proxy = hide(new Proxy(target, { label: "plain" }));
  fill(proxy, 300);
  console.log(counted(() => fill(proxy, 300)), target.width);
});
test("unseen code stores", () => {
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
  fillUnseen(proxy, 300);
  console.log(counted(() => fillUnseen(proxy, 300)), target.width);
});
test("unseen code makes the proxy", () => {
  const target = { width: 1 }, proxy = (0, eval)("(target, handler) => new Proxy(target, handler)")(target, { label: "plain" });
  fill(proxy, 300);
  console.log(counted(() => fill(proxy, 300)), target.width);
});
test("unseen code makes the handler", () => {
  const target = { width: 1 }, proxy = new Proxy(target, (0, eval)("({ label: 'plain' })"));
  fill(proxy, 300);
  console.log(counted(() => fill(proxy, 300)), target.width);
});
