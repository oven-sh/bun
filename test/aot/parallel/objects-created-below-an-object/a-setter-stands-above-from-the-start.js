// `Object.create(parent)` is an allocation of a layout of its own; what its maker stores behind it are fields, and a store that creates one asks a guard that nothing above takes it. ONE DEED: the parent has a setter under a name that the maker stores.
const log = [];
const holder = (globalThis.holder = { parent: { shared: "above", method() { return "m:" + this.first; }, get both() { return this.first + "+" + this.second; } } });
// Nobody knows the parent: it is read off an object that unseen code has.
function make(first, second) {
  const made = Object.create(holder.parent);
  made.first = first;
  made.second = second;
  return made;
}
holder.make = make;
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name + ": " + e.message; } };
const show = (o) => attempt(() => [o.first, o.second, o.shared, typeof o.method === "function" ? o.method() : "-", o.both, Object.keys(o).join(), JSON.stringify(o), Object.getPrototypeOf(o) === holder.parent].map(String).join(" | "));
Object.defineProperty(holder.parent, "second", { set(v) { log.push("set " + v); }, get() { return "got"; }, configurable: true });
for (let i = 0; i < 3; i++) console.log(show(holder.make(i, i + 1)));
console.log(log.join());
