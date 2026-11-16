// `Object.create(parent)` is an allocation of a layout of its own; what its maker stores behind it are fields, and a store that creates one asks a guard that nothing above takes it. ONE DEED: the parent gets a value under the name that may not be written.
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
console.log(show(holder.make(1, 2)));
Object.defineProperty(holder.parent, "first", { value: "fixed", writable: false, configurable: true });
console.log(show(attempt(() => holder.make(3, 4))));
const strict = attempt(() => { const made = Object.create(holder.parent); made.first = 1; return "stored"; });
console.log(strict);
