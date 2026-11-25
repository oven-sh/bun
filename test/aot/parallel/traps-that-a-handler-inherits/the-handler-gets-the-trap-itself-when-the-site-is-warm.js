// The handler is a literal. Behind 300 stores it gets the trap as a property of its own, loses it, and gets it again.
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
function run(what, handler, target) {
  let defined = 0, described = 0;
  const proxy = new Proxy(target, handler), told = [];
  fill(proxy, 300); told.push(defined, described);
  handler.defineProperty = function (target, key, descriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); };
  fill(proxy, 100); told.push(defined, described);
  delete handler.defineProperty;
  fill(proxy, 50); told.push(defined, described);
  handler.getOwnPropertyDescriptor = function (target, key) { described++; return Reflect.getOwnPropertyDescriptor(target, key); };
  fill(proxy, 25); told.push(defined, described);
  handler.getOwnPropertyDescriptor = undefined;
  fill(proxy, 12); told.push(defined, described);
  Object.defineProperty(handler, "defineProperty", { configurable: true, get() { return function (target, key, descriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); }; } });
  fill(proxy, 6); told.push(defined, described);
  console.log(what, told.join(" "), target.width);
}
class Box { width = 1; height = 2; }
run("a literal without a field for it", { label: "plain" }, { width: 1 });
run("a literal with empty fields for both", { label: "plain", defineProperty: undefined, getOwnPropertyDescriptor: undefined }, { width: 1 });
run("an empty literal", {}, { width: 1 });
run("over an instance", { label: "plain" }, new Box());
run("over an ordinary object", { label: "plain" }, JSON.parse('{"width":1}'));
run("an ordinary handler over a literal", JSON.parse('{"label":"plain"}'), { width: 1 });
{
  let defined = 0;
  const list = [1, 2, 3], handler = { label: "plain" }, proxy = new Proxy(list, handler), told = [];
  for (let i = 0; i < 300; i++) proxy[i % 3] = i;
  told.push(defined);
  handler.defineProperty = function (target, key, descriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); };
  for (let i = 0; i < 100; i++) proxy[i % 3] = i;
  told.push(defined);
  console.log("over a list", told.join(" "), list.join());
}
