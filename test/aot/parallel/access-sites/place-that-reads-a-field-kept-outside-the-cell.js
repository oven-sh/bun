// Properties that are stored on the objects of a class long after they were made lie outside the cell, each object holding room only for those that it has.
// `node.parent` on a receiver of unknown kind: the place remembers the layout and which of them it is.
class Node { constructor(kind) { this.kind = kind; } }
class Leaf { constructor(kind) { this.kind = kind; this.parent = "in the cell of " + kind; } }
function link(node, parent, flags, symbol, id) { node.parent = parent; node.flags = flags; node.symbol = symbol; node.id = id; }
function linkSome(node, symbol) { node.symbol = symbol; }
const parentOf = x => x.parent, flagsOf = x => x.flags, symbolOf = x => x.symbol, idOf = x => x.id;
const attempt = f => { try { return f(); } catch (error) { return error.constructor.name; } };
const all = x => [parentOf(x), flagsOf(x), symbolOf(x), idOf(x)].map(String).join();
let last;
const warm = () => { let sum = 0; for (let i = 0; i < 400; i++) { last = new Node(i); link(last, "p" + i, i, "s" + i, i * 2); sum += flagsOf(last) + idOf(last) + parentOf(last).length + symbolOf(last).length; } return sum; };
console.log(warm(), all(last));
// An object of the layout that has none of them, one that has one, one that got them in another order.
console.log(all(new Node(1)));
const some = new Node(2); linkSome(some, "only"); console.log(all(some));
const backward = new Node(3); backward.id = 1; backward.symbol = "s"; backward.flags = 2; backward.parent = "p"; console.log(all(backward), Object.keys(backward).join());
// One that lost one, got it back, has it as an accessor, as read-only, holds undefined or null in it.
const changed = new Node(4); link(changed, "p", 1, "s", 2); delete changed.flags; console.log(all(changed), "flags" in changed); changed.flags = 7; console.log(all(changed), Object.keys(changed).join());
Object.defineProperty(changed, "symbol", { get() { return "getter of " + this.kind; }, configurable: true }); console.log(all(changed));
Object.defineProperty(changed, "id", { value: 9, writable: false }); console.log(all(changed)); Object.freeze(changed); console.log(all(changed));
const holes = new Node(5); link(holes, undefined, null, 0, ""); console.log(all(holes), Object.keys(holes).join());
// What lies above counts where the object lacks it.
Node.prototype.flags = "above"; console.log(all(new Node(6)), all(last)); delete Node.prototype.flags; console.log(all(new Node(7)));
// Another layout that has the name in its cell, other cells, and what is no cell, at the filled places.
console.log(warm(), parentOf(new Leaf(8)), parentOf({ parent: "plain" }), parentOf([]), parentOf(new Map()), parentOf("text"), parentOf(5), attempt(() => parentOf(null)), attempt(() => parentOf(undefined)));
let turns = 0; for (let i = 0; i < 600; i++) { const x = i % 2 ? new Leaf(i) : last; turns += parentOf(x).length; } console.log(turns);
class Wide extends Node { constructor(kind) { super(kind); this.a = 1; this.b = 2; } }
for (let i = 0; i < 300; i++) { last = new Wide(i); link(last, "w" + i, i, "ws", i); if (parentOf(last) !== "w" + i || idOf(last) !== i) console.log("wrong", i); } console.log(all(last), Object.keys(last).join());
// Values that the room outside the cell alone keeps alive.
const kept = []; for (let i = 0; i < 3000; i++) { const n = new Node(i); link(n, { i }, i, [i], i); kept.push(n); } Bun.gc(true);
let sum = 0; for (const n of kept) sum += parentOf(n).i + symbolOf(n)[0]; console.log(sum);
