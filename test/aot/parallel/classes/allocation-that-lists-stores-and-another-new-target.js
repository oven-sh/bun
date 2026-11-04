// a constructor function whose allocation lists its first stores is constructed for another new target: by a class below it, by Reflect.construct under a hidden name, and called on an object that was made long ago
const hidden = JSON.parse('{"construct":"construct"}');
function Node(kind, pos) { this.pos = pos; this.kind = kind; this.id = 0; }
function Other() { }
Other.prototype.marked = "other";
class Below extends Node { constructor(kind) { super(kind, -2); this.below = true; } }
function make(kind) { return new Node(kind, -1); }
function makeBelow(kind) { return new Below(kind); }
function deed(kind) { return Reflect[hidden.construct](Node, [kind, -3], Other); }
function show(node) { return Object.keys(node).join() + " " + JSON.stringify(node) + " " + (node instanceof Node) + " " + (node instanceof Below) + " " + (node instanceof Other) + " " + String(node.marked); }
console.log(show(make(0)), show(makeBelow(0)), show(deed(0)));
for (let turn = 1; turn < 300; turn++) { make(turn); makeBelow(turn); deed(turn); }
console.log(show(make(1)), show(makeBelow(1)), show(deed(1)));
const older = { id: "first", extra: 1 };
Node.call(older, 7, 8);
console.log(show(older));
console.log(show(make(2)));
