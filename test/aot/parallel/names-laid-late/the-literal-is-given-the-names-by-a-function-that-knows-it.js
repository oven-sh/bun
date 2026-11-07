// A function that is handed nothing but the literal stores, late, the names that the literal's accessors lay on the created objects: compiled code that knows the literal's layout must not fill it unseen.
"use strict";
const said = [];
let taken = 0;
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
function lay(target, value) {
  target._label = value;
  target._first = value;
  target.turns = 0;
}
function look(name) {
  const fresh = store.make(name);
  const before = [fresh.label, fresh.first, Object.hasOwn(fresh, "_label")];
  let thrown = "";
  try { fresh.label = "own"; } catch (error) { thrown = error.name; }
  said.push(name + ": " + before.join() + " > " + [fresh.label, fresh.first, Object.hasOwn(fresh, "_label"), fresh.turns, thrown, taken].join());
}
function warm() {
  let sum = 0;
  for (let round = 0; round < 1500; round++) {
    const made = store.make(round);
    sum += made.label === undefined ? 1 : 1000;
    try { made.label = round; } catch (error) { sum += 100000; }
    sum += made.label === round && made.first === round ? 1 : 1000;
  }
  return sum;
}
said.push(warm());
look("before");
for (let round = 0; round < 3; round++) lay(shelf, "by a function " + round);
look("behind");
said.push(warm());
delete shelf._label;
delete shelf._first;
look("taken back");
said.push(warm());
console.log(said.join("\n"));
