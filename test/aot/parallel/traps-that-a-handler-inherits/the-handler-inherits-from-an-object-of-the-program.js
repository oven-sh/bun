// In an executable nothing is laid on Object.prototype. A handler inherits a trap from an object of the program: by Object.create, by a class, by __proto__ in the literal, by Object.setPrototypeOf behind 300 stores.
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
const count = { defined: 0, described: 0 };
const traps = {
  defineProperty(target, key, descriptor) { count.defined++; return Reflect.defineProperty(target, key, descriptor); },
  getOwnPropertyDescriptor(target, key) { count.described++; return Reflect.getOwnPropertyDescriptor(target, key); },
};
class Handler {
  label = "plain";
  defineProperty(target, key, descriptor) { count.defined++; return Reflect.defineProperty(target, key, descriptor); }
}
function run(what, handler) {
  count.defined = count.described = 0;
  const target = { width: 1, height: 2 };
  fill(new Proxy(target, handler), 300);
  console.log(what, count.defined, count.described, target.width);
}
run("Object.create", Object.create(traps));
run("an instance", new Handler());
run("__proto__ in the literal", { __proto__: traps, label: "plain" });
run("two levels", Object.create(Object.create(traps)));
run("a literal", { label: "plain" });
run("an empty literal", {});
{
  count.defined = count.described = 0;
  const target = { width: 1 }, handler = { label: "plain" }, proxy = new Proxy(target, handler), told = [];
  fill(proxy, 300); told.push(count.defined, count.described);
  Object.setPrototypeOf(handler, traps);
  fill(proxy, 100); told.push(count.defined, count.described);
  Object.setPrototypeOf(handler, Object.prototype);
  fill(proxy, 50); told.push(count.defined, count.described);
  Object.setPrototypeOf(handler, null);
  fill(proxy, 25); told.push(count.defined, count.described);
  console.log("set later", told.join(" "), target.width);
}
{
  count.defined = count.described = 0;
  const above = { label: "above" }, target = { width: 1 }, proxy = new Proxy(target, Object.create(above)), told = [];
  fill(proxy, 300); told.push(count.defined);
  above.defineProperty = traps.defineProperty;
  fill(proxy, 100); told.push(count.defined);
  delete above.defineProperty;
  fill(proxy, 50); told.push(count.defined);
  console.log("laid on the object above when the site is warm", told.join(" "), target.width);
}
