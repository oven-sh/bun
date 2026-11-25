// The created object is frozen, sealed, closed, laid below another object, or given the late name in another form before the accessors above it lay the name.
"use strict";
const said = [];
const shelf = {
  get label() { return this._label; },
  set label(value) {
    const before = this._label;
    this._label = value;
    if (before === undefined) this._first = value;
    this.turns = this.turns + 1;
  },
  get first() { return this._first; },
};
class Store {
  constructor() { this.shelf = Object.create(shelf); }
  make(tag) {
    const made = Object.create(this.shelf);
    made.tag = tag;
    made.turns = 0;
    return made;
  }
}
const store = new Store();
let sum = 0;
for (let round = 0; round < 1500; round++) {
  const made = store.make(round);
  made.label = round;
  sum += made.label + made.first + made.turns;
}
said.push(sum);
const deeds = {
  "as made": made => made,
  "frozen": made => Object.freeze(made),
  "sealed": made => Object.seal(made),
  "closed": made => Object.preventExtensions(made),
  "below another object": made => Object.setPrototypeOf(made, { _label: "of the other", set label(value) { said.push("the other's setter takes " + value); }, get label() { return "the other's getter"; } }),
  "below nothing": made => Object.setPrototypeOf(made, null),
  "below the literal itself": made => Object.setPrototypeOf(made, shelf),
  "the name defined as an accessor": made => Object.defineProperty(made, "_label", { get() { return "own getter"; }, set(value) { said.push("own setter takes " + value); }, configurable: true }),
  "the name defined as a value that takes no store": made => Object.defineProperty(made, "_label", { value: "fixed", configurable: true }),
  "the name defined hidden": made => Object.defineProperty(made, "_label", { value: "hidden", writable: true, configurable: true, enumerable: false }),
  "the name laid by hand": made => { made._label = "by hand"; return made; },
  "the name laid and taken away": made => { made._label = "by hand"; delete made._label; return made; },
  "other names laid first": made => { made.zebra = 1; made[Symbol.for("mark")] = 2; made[7] = 3; return made; },
  "the maker's name taken away": made => { delete made.turns; return made; },
};
for (const [name, deed] of Object.entries(deeds)) {
  const made = deed(store.make(name));
  const row = [name];
  for (const value of ["first", "second"]) {
    try { row.push(String(made.label), String(made.first)); } catch (error) { row.push(error.name); }
    try { made.label = value; } catch (error) { row.push(error.name); }
  }
  row.push(Reflect.ownKeys(made).map(String).join("+"), String(made._label), String(made.turns));
  said.push(row.join(" | "));
}
console.log(said.join("\n"));
