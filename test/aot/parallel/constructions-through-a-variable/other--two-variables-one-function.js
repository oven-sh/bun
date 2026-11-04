function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var First, Second;
function start() { First = Node; Second = Node; }
start();
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += (i & 1 ? new First(i, 0) : new Second(i, 1)).kind; return t; }
console.log(run(9));
