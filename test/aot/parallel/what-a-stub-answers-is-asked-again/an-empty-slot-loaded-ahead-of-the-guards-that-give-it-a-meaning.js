// Flags: --aot-testing=CheckWalkAtRunTime
// A name comes to lie above the receiver when the prototype of an object in the middle of the chain is changed, in the loop that reads the name through a getter. The load of the receiver's own slot stands in front of the turns; the guards that make an empty slot mean undefined stand in them, and where they fail the turn begins again and the load is thrown away. Under the word that checks the walk the load alone may not be held against the object.
// COUNTER: AnswersAskedAgain >= 1
const printValue = (...all) => console.log(all.map(one => (Object.is(one, -0) ? "-0" : String(one))).join(" "));
const shelf_1 = { get label() { return this._label; }, set label(value) { this._label = value; } };
function makeMiddle_1(tag) { const middle = Object.create(shelf_1); middle.tag = tag; return middle; }
function makeLeaf_1(above, tag) { const leaf = Object.create(above); leaf.tag = tag; return leaf; }
function decorate_1(target) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; target.zebra = work; }
function watch_1(leaf, middle, turns, when) { let found = 0; for (let turn = 0; turn < turns; turn++) { if (leaf.label !== undefined) found++; if (turn === when) Object.setPrototypeOf(middle, { _label: "late", __proto__: shelf_1 }); } return found; }
const spare_1 = makeMiddle_1("spare");
const center_1 = makeMiddle_1("middle");
decorate_1(center_1);
const leaves_1 = [makeLeaf_1(center_1, 1), makeLeaf_1(center_1, 2), makeLeaf_1(center_1, 3)];
printValue("late 1", watch_1(leaves_1[1], center_1, 3000, 5), watch_1(leaves_1[2], center_1, 3000, 3009), String(leaves_1[1].label), leaves_1[0].tag, Object.keys(center_1).join());
export {};
