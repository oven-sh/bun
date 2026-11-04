const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function make(kind) { return new Maker(kind, 1); }
const tell = (o) => Object.keys(o).join();
const show = (when) => console.log(when, attempt(() => tell(make(2))), attempt(() => tell(make(3))));
Object.defineProperty(Node.prototype, "pos", { set(v) { }, get() { return "from above"; } }); start(); show("a");
