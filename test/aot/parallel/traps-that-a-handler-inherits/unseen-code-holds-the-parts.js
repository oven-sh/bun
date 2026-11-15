// The handler and the object above it pass through code that the build has not seen, and such code lays the trap.
const hide = (0, eval)("(x) => x");
const lay = (0, eval)("(object, trap) => { object.defineProperty = trap; }");
function fill(proxy, count) { for (let i = 0; i < count; i++) proxy.width = i; }
let defined = 0;
const trap = function (target, key, descriptor) { defined++; return Reflect.defineProperty(target, key, descriptor); };
{
  const target = { width: 1 }, handler = { label: "plain" }, proxy = new Proxy(target, handler), told = [];
  fill(proxy, 300); told.push(defined);
  lay(handler, trap);
  fill(proxy, 100); told.push(defined);
  console.log("laid on the handler", told.join(" "), target.width);
}
{
  defined = 0;
  const above = { label: "above" }, target = { width: 1 }, proxy = new Proxy(target, hide(Object.create(above))), told = [];
  fill(proxy, 300); told.push(defined);
  lay(above, trap);
  fill(proxy, 100); told.push(defined);
  console.log("laid above the handler", told.join(" "), target.width);
}
