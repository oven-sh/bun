const attempt = (f) => { try { return f(); } catch (e) { return "threw " + e.name; } };
const kept = { kind: 500, pos: 5 };
function pick(kind) { return kind === 3 ? kept : undefined; }
function Node(kind, pos) { this.kind = kind; this.pos = pos; return pick(kind); }
var Maker;
function start() { Maker = Node; }
function make(kind) { return new Maker(kind, 1); }
const tell = (o) => Object.keys(o).join();
const show = (when) => console.log(when, attempt(() => tell(make(2))), attempt(() => tell(make(3))));
start(); show("a");
