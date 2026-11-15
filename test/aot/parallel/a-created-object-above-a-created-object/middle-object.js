"use strict";
const shelf = { get label() { return this._label; }, set label(value) { this._label = value; } };
class Store { constructor() { this.shelf = Object.create(shelf); } make(tag) { const made = Object.create(this.shelf); made.tag = tag; return made; } }
const store = new Store(), other = new Store(), said = [];
function count(from, turns) { let seen = 0; for (let turn = 0; turn < turns; turn++) { const made = from.make(turn); if (made.label !== undefined) seen++; } return seen; }
const deeds = [() => { other.shelf._label = "other"; }, () => { store.shelf._label = "middle"; }, () => { delete store.shelf._label; },
  () => { Object.defineProperty(store.shelf, "_label", { get() { return "got"; }, configurable: true }); },
  () => { delete store.shelf._label; Object.setPrototypeOf(store.shelf, { _label: "above", __proto__: shelf }); }];
said.push(count(store, 300), count(other, 300));
for (const deed of deeds) { deed(); said.push(count(store, 300), count(other, 300)); }
console.log(said.join());
