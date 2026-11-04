function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
async function make(k) { await null; return new Maker(k, 1).kind; }
console.log(await make(1).catch((e) => "rejected " + e.name)); start(); console.log(await make(2));
