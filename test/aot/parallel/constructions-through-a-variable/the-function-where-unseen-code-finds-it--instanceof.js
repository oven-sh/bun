const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function make(kind) { return new Maker(kind, 1); }
const tell = (o) => (o instanceof Node) + "";
const show = (when) => console.log(when, attempt(() => tell(make(2))), attempt(() => tell(make(3))));
globalThis["ke" + "pt"] = Node; start(); show("a"); globalThis["ke" + "pt"].prototype = { from: "out of sight" }; show("b");
