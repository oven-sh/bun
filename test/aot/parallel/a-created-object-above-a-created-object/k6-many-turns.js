"use strict";
const shelf = { get label() { return this._label; }, set label(value) { this._label = value; } };
function makeMiddle(tag) { const middle = Object.create(shelf); middle.tag = tag; return middle; }
function makeLeaf(above, tag) { const leaf = Object.create(above); leaf.tag = tag; return leaf; }
function decorate(target) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; target.zebra = work; }
function watch(leaf, middle, turns, when) {
  let found = 0;
  for (let turn = 0; turn < turns; turn++) {
    if (leaf._label !== undefined) found++;
    if (turn === when) middle._label = "late";
  }
  return found;
}
const spare = makeMiddle("spare"), middle = makeMiddle("middle");
spare.label = "text";
decorate(middle);
const first = makeLeaf(middle, 1), second = makeLeaf(middle, 2), third = makeLeaf(middle, 3);
console.log("found", watch(second, middle, 3000, 1500), "then", watch(third, middle, 3000, 9999), second.label, first.tag, Object.keys(middle).join());
