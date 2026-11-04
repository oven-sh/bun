// 300 stores go through the proxy, then the name is laid on Object.prototype, then it is taken away again. Each kind of handler by itself.
import { test } from "bun:test";
class Handler { label = "plain"; }
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
function run(what, handler) {
  let defined = 0, described = 0;
  const target = { width: 1, height: 2 }, proxy = new Proxy(target, handler), told = [];
  fill(proxy, 300);
  told.push(defined, described, target.width);
  Object.prototype.defineProperty = function (target, key, descriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); };
  try { fill(proxy, 10); } finally { delete Object.prototype.defineProperty; }
  told.push(defined, described, target.width);
  fill(proxy, 5);
  told.push(defined, described, target.width);
  Object.prototype.getOwnPropertyDescriptor = function (target, key) { described++; return Reflect.getOwnPropertyDescriptor(target, key); };
  try { fill(proxy, 7); } finally { delete Object.prototype.getOwnPropertyDescriptor; }
  told.push(defined, described, target.width);
  fill(proxy, 3);
  told.push(defined, described, target.width);
  console.log(what, told.join(" "));
}
test("a literal", () => run("a literal", { label: "plain" }));
test("an empty literal", () => run("an empty literal", {}));
test("an instance", () => run("an instance", new Handler()));
test("out of JSON.parse", () => run("out of JSON.parse", JSON.parse('{"label":"plain"}')));
test("below a literal", () => run("below a literal", Object.create({ label: "plain" })));
test("a list", () => run("a list", []));
test("a function", () => run("a function", function () {}));
