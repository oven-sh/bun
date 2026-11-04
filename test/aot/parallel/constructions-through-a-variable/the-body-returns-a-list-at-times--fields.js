const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
function Node(kind, pos) { this.kind = kind; this.pos = pos; if (kind === 3) return [kind]; }
var Maker;
function start() { Maker = Node; }
function make(kind) { return new Maker(kind, 1); }
const tell = (o) => o.kind + "," + o.pos;
const show = (when) => console.log(when, attempt(() => tell(make(2))), attempt(() => tell(make(3))));
start(); show("a");
