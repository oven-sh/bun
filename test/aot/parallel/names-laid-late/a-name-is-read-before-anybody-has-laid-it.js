// An object is created below an object that is created below a literal. The literal's accessors lay names on it that its maker does not lay: the first read of such a name in the life of every object finds nothing.
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
  describe() { return this.tag + ":" + this._label + ":" + this._first + ":" + this.turns; },
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
let length = 0;
for (let round = 0; round < 2000; round++) {
  const made = store.make(round);
  if (made.label !== undefined || made.first !== undefined) said.push("round " + round + " finds a name that nobody has laid");
  made.label = "a" + round;
  made.label = "b";
  length += made.label.length + made.first.length + made.turns;
}
said.push(length);
const one = store.make("one");
said.push(Object.keys(one).join(), "_label" in one, Object.hasOwn(one, "_label"), one.describe());
one.label = 1;
said.push(Object.keys(one).join(), "_label" in one, Object.hasOwn(one, "_label"), one.describe());
one.label = undefined;
one.label = 2;
said.push(Object.keys(one).join(), one.describe(), JSON.stringify(one));
delete one._label;
said.push(Object.keys(one).join(), one.label, one.describe());
one.label = 3;
said.push(Object.keys(one).join(), one.describe());
console.log(said.join("\n"));
