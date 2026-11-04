// a function that fills ten fields is constructed through a variable, called on an older object, and then finds a setter and a frozen prototype above its objects
function Node(kind, pos, end) { this.pos = pos; this.end = end; this.kind = kind; this.id = 0; this.flags = 0; this.cache = 0; this.transform = 0; this.parent = undefined; this.original = undefined; this.emit = undefined; }
const allocator = { get: () => Node };
let Constructor;
function make(kind) { return new (Constructor || (Constructor = allocator.get()))(kind, -1, -1); }
function show(node) { return Object.keys(node).join() + " " + node.kind + " " + node.pos + " " + node.end + " " + String(node.parent); }
for (let turn = 0; turn < 3; turn++) console.log(show(make(turn)));
const older = { end: "kept first", extra: 1 };
Node.call(older, 7, 8, 9);
console.log(show(older));
const seen = [];
Object.defineProperty(Node.prototype, "flags", { set(value) { seen.push(value); }, get() { return "from above"; }, configurable: true });
const behindSetter = make(4);
console.log(show(behindSetter), behindSetter.flags, seen.join());
delete Node.prototype.flags;
console.log(show(make(5)));
Node.prototype = { marked: true };
console.log(make(6).marked, make(6) instanceof Node);
console.log(show(Reflect.construct(Node, [8, 1, 2], function Other() {})));
