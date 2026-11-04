// The tests lay other names on Object.prototype, or none. No trap is inherited, and the stores end in the target.
import { test } from "bun:test";
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
test("no name is laid", () => {
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
  fill(proxy, 300);
  console.log(target.width, proxy.width, Object.keys(proxy).join());
});
test("another name is laid", () => {
  const target = { width: 1 }, proxy = new Proxy(target, { label: "plain" });
  Object.prototype.marker = function () { return 7; };
  try { fill(proxy, 300); console.log(target.width, proxy.marker(), target.marker()); } finally { delete Object.prototype.marker; }
  fill(proxy, 5);
  console.log(target.width, typeof proxy.marker);
});
