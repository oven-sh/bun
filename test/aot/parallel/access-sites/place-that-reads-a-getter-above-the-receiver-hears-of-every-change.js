// A place that reads a getter which lies above the receiver remembers the word that holds its GetterSetter: in the cell of the holder, or in its storage. Each place is warmed on its own, then an object on the way changes, or another kind of receiver comes by.
const slot = JSON.parse("[0]");
function through(value) { slot[0] = value; return slot[0]; }
function lay(o, name, tag) { Object.defineProperty(o, name, { get() { return tag + ":" + name + ":" + (this === o ? "holder" : "below"); }, enumerable: true, configurable: true }); }
function few(tag) { const o = {}; lay(o, "size", tag); return o; }
function many(tag) { const o = {}; for (let k = 0; k < 40; k++) lay(o, "n" + k, tag); lay(o, "size", tag); return o; }
function warm(read, o) { let last; for (let i = 0; i < 400; i++) last = read(o); return last; }
function attempt(read, o) { try { return String(read(o)); } catch (e) { return e instanceof TypeError ? "TypeError" : e instanceof RangeError ? "RangeError" : "other error"; } }
function log(...parts) { console.log(parts.join(" | ")); }
function compiled0(o) { return o.size; } function compiled1(o) { return o.size; } function compiled2(o) { return o.size; } function compiled3(o) { return o.size; } function compiled4(o) { return o.size; }
function compiled5(o) { return o.size; } function compiled6(o) { return o.size; } function compiled7(o) { return o.size; } function compiled8(o) { return o.size; } function compiled9(o) { return o.size; }
function compiled10(o) { return o.size; } function compiled11(o) { return o.size; } function compiled12(o) { return o.size; } function compiled13(o) { return o.size; } function compiled14(o) { return o.size; }
function compiled15(o) { return o.size; } function compiled16(o) { return o.size; } function compiled17(o) { return o.size; }
const places = [compiled0, compiled1, compiled2, compiled3, compiled4, compiled5, compiled6, compiled7, compiled8, compiled9, compiled10, compiled11, compiled12, compiled13, compiled14, compiled15, compiled16, compiled17];
let next = 0;
const steps = [
  ["another getter", (holder) => { Object.defineProperty(holder, "size", { get() { return "another getter"; } }); }],
  ["a value in its place", (holder) => { Object.defineProperty(holder, "size", { value: "a value now", writable: true }); }],
  ["deleted", (holder) => { delete holder.size; }],
  ["a setter alone", (holder) => { Object.defineProperty(holder, "size", { get: undefined, set(v) {} }); }],
  ["a getter that throws", (holder) => { Object.defineProperty(holder, "size", { get() { throw new RangeError("thrown"); } }); }],
  ["a name more on the holder", (holder) => { holder.more = 1; }],
  ["hidden by the object in between", (holder, between) => { Object.defineProperty(between, "size", { value: "in between", writable: true, enumerable: true, configurable: true }); }],
  ["the object in between moved", (holder, between) => { Object.setPrototypeOf(between, { size: "elsewhere" }); }],
  ["hidden by the receiver", (holder, between, receiver) => { Object.defineProperty(receiver, "size", { value: "own" }); }],
];
for (const make of [few, many]) {
  for (const [what, step] of steps) {
    const read = places[next++];
    const holder = make(what);
    const between = Object.create(holder);
    const receiver = through(Object.create(between));
    const sibling = through(Object.create(between));
    log(what + ": before", warm(read, receiver));
    step(holder, between, receiver);
    log(what + ": behind", attempt(read, receiver), attempt(read, sibling), attempt((o) => warm(read, o), receiver), attempt((o) => warm(read, o), sibling));
  }
}
class Above { get size() { return "of the class:" + this.tag; } }
class Leaf extends Above { constructor(tag) { super(); this.tag = tag; } }
function readLeaf(o) { return o.size; }
log("a class above a compiled object", warm(readLeaf, through(new Leaf("one"))), attempt(readLeaf, through(new Leaf("two"))));
log("then others", attempt(readLeaf, through({ size: "plain" })), attempt(readLeaf, 5), attempt(readLeaf, "text"), attempt(readLeaf, null), attempt(readLeaf, undefined), attempt(readLeaf, through(new Leaf("three"))));
Object.defineProperty(Above.prototype, "size", { get() { return "redefined:" + this.tag; }, configurable: true });
log("the accessor of the class redefined", attempt(readLeaf, through(new Leaf("four"))), warm(readLeaf, through(new Leaf("five"))));
Object.setPrototypeOf(Leaf.prototype, { get size() { return "another class above"; } });
log("the prototype object moved", attempt(readLeaf, through(new Leaf("six"))), warm(readLeaf, through(new Leaf("seven"))));
