// A setter or getter is asked for by name after unknown code had the object, and a descriptor arrives after the object.
function main() {
const holder = { plain: 1 };
function look() { return [typeof holder.__lookupSetter__("late"), typeof holder.__lookupGetter__("late"), typeof Object.getOwnPropertyDescriptor(holder, "late")?.set]; }
console.log(look().join());
globalThis.escaped = holder;
new Function("Object.defineProperty(escaped, 'late', { set(v) { this.plain = 'set ' + v; }, get() { return 'got'; }, configurable: true })")();
console.log(look().join());
const setter = holder.__lookupSetter__("late");
if (setter) setter.call(holder, 5);
console.log(holder.plain, holder.late);

let descriptor = 1;
const target = { a: 1 };
for (let i = 0; i < 3; i++) {
  try { Object.defineProperty(target, "a", descriptor); } catch (e) { descriptor = i ? { get() { return { from: "getter" }; } } : { value: "text", configurable: true }; }
  if (i === 1) descriptor = 2;
}
console.log(typeof target.a, target.a.from);
let map = { p: { value: 1, configurable: true, writable: true } };
const many = {};
function grow() { map = { q: { get() { return "q getter"; } }, p: { value: "p text" } }; }
for (let i = 0; i < 2; i++) { Object.defineProperties(many, map); [0].forEach(grow); }
console.log(typeof many.p, many.q);
}
main();
