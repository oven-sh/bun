// A built-in that takes only objects throws for a primitive among the values of its operand.
function create(proto) {
  try { return typeof Object.create(proto); } catch (e) { return "caught " + e.constructor.name; }
}
function keys(target) {
  try { return Reflect.ownKeys(target).length; } catch (e) { return "caught " + e.constructor.name; }
}
function time(date) {
  try { return typeof Date.prototype.getTime.call(date); } catch (e) { return "caught " + e.constructor.name; }
}
function size(map) {
  try { return Object.getOwnPropertyDescriptor(Map.prototype, "size").get.call(map); } catch (e) { return "caught " + e.constructor.name; }
}
function proto(value) {
  try { return typeof Reflect.getPrototypeOf(value); } catch (e) { return "caught " + e.constructor.name; }
}
function entries(map) {
  try { return typeof Map.prototype.entries.call(map); } catch (e) { return "caught " + e.constructor.name; }
}
function task(f) {
  try { queueMicrotask(f); return "queued"; } catch (e) { return "caught " + e.constructor.name; }
}
function promise(executor) {
  try { return typeof new Promise(executor); } catch (e) { return "caught " + e.constructor.name; }
}
function proxy(target) {
  try { return typeof new Proxy(target, {}); } catch (e) { return "caught " + e.constructor.name; }
}
function main() {
  console.log(create({ a: 1 }), create(5), create(null), create("text"));
  console.log(keys({ a: 1 }), keys(5));
  console.log(proto({}), proto(5));
  console.log(proxy({}), proxy(5));
}
main();
