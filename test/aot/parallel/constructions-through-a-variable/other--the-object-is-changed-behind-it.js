function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function make(k) { return new Maker(k, 1); }
start();
const a = make(1); delete a.pos; const b = make(2); b.extra = 5; const c = Object.freeze(make(3)); const d = Object.setPrototypeOf(make(4), null);
function tell(o) { return o.kind + "," + o.pos + "," + o.extra + "," + Object.keys(o).join("+"); }
console.log(tell(a), tell(b), tell(c), tell(d), Object.isFrozen(c), tell(make(5)));
