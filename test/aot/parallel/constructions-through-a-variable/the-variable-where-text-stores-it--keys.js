const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function make(kind) { return new Maker(kind, 1); }
const tell = (o) => Object.keys(o).join();
const show = (when) => console.log(when, attempt(() => tell(make(2))), attempt(() => tell(make(3))));
start(); show("a"); globalThis.setIt = (f) => { Maker = f; }; new Function("globalThis.setIt(function (k) { this.kind = k + 1000; this.pos = 0; })")(); show("b");
