// A built-in function goes through native code and comes back as a value nobody can follow. A `call` of its own is planted on it by name.
// The store is refused whoever implements the function, and compiled code goes on finding Function.prototype.call. It may not work and be ignored.
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
function target() { return "the target ran"; }
const rows = [
  ["Function.prototype.call", Function.prototype.call, () => Function.prototype.call.call(target, null)],
  ["Function.prototype.apply", Function.prototype.apply, () => Function.prototype.apply.call(target, null, [])],
  ["Array.prototype.map", Array.prototype.map, () => String(Array.prototype.map.call([1, 2], x => x * 2))],
  ["Array.prototype.filter", Array.prototype.filter, () => String(Array.prototype.filter.call([1, 2], x => x > 1))],
  ["Reflect.get", Reflect.get, () => String(Reflect.get.call(null, { a: 7 }, "a"))],
  ["Array.prototype.slice", Array.prototype.slice, () => String(Array.prototype.slice.call([1, 2], 1))],
  ["Math.max", Math.max, () => String(Math.max.call(null, 1, 2))],
];
for (const [name, builtin, use] of rows) {
  const before = use();
  let verdict = "stored";
  try {
    unknown(builtin).call = function planted() { return "planted ran"; };
  } catch (error) {
    verdict = "refused (" + error.constructor.name + ")";
  }
  console.log(name + ":", before, "|", verdict, "|", use(), "|", Object.hasOwn(builtin, "call"));
}
