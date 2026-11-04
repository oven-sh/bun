function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function make(k) { try { return new Maker(k, 1).kind; } catch (e) { return "caught " + e.name; } finally { console.log("finally", k); } }
console.log(make(1)); start(); console.log(make(2));
