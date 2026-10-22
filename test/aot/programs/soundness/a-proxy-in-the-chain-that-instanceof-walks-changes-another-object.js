// `value instanceof Class` walks the prototype chain of the value. A proxy in that chain answers with code of the program, which here changes another object between two reads of it.
class Class {}
class Other {}
function around(counter, value) {
  const before = counter.count;
  const is = value instanceof Class;
  const after = counter.count;
  return String(before) + " " + is + " " + String(after);
}
function make() {
  return { count: 1, name: "counter" };
}
let victim = make();
let what = 0;
const handler = {
  getPrototypeOf() {
    if (what === 1) delete victim.count;
    if (what === 2) victim.count = "text";
    if (what === 3) victim.count = undefined;
    if (what === 4) Object.defineProperty(victim, "count", { get() { return "from a getter"; }, configurable: true });
    if (what === 5) victim.count = 2.5;
    return what === 6 ? Class.prototype : null;
  },
};
const proxy = new Proxy({}, handler);
const below = Object.create(proxy);
let warm = 0;
for (let i = 0; i < 3000; i++) warm += around(make(), i % 3 ? new Class() : i % 2 ? new Other() : {}).length;
console.log(warm);
for (what = 0; what <= 6; what++) {
  victim = make();
  console.log(what, around(victim, proxy));
  victim = make();
  console.log(what, around(victim, below));
}
