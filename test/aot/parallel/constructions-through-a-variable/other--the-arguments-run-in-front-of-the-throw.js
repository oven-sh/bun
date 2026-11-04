const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
const said = [];
const log = (x) => { said.push(x); return x; };
console.log(attempt(() => new Maker(log("a"), log("b"))), said.join());
