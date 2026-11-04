function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
const allocator = { get() { return Node; } };
function make(k) { return new (Maker || (Maker = allocator.get()))(k, -1); }
console.log(make(1).kind, make(2).pos, Object.keys(make(3)).join());
