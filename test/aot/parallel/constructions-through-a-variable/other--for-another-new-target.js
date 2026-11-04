function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function Other() { }
start();
const o = Reflect.construct(Maker, [1, 2], Other);
console.log(o.kind, o instanceof Node, o instanceof Other);
