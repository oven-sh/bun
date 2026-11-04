function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
try { new Maker(1, 2); } catch (e) { console.log(e.name, e.message, e instanceof TypeError); }
start(); console.log(new Maker(1, 2).kind);
