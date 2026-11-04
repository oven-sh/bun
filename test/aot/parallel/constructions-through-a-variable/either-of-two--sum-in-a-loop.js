const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; }
var Maker;
function start() { Maker = Node; }
function make(kind) { return new Maker(kind, 1); }
const tell = (o) => { let t = 0; for (let i = 0; i < 50; i++) t += make(i & 3).kind; return t + o.kind; };
const show = (when) => console.log(when, attempt(() => tell(make(2))), attempt(() => tell(make(3))));
function Other(kind) { this.kind = kind + 100; this.pos = 9; } Maker = process.argv.length < 99 ? Other : Node; show("a");
