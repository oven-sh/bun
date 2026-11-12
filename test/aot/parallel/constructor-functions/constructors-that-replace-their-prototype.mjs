// The prototype of a new object is read in front of the constructor's body, which may store under `prototype`.
const lines = [];
const say = (...values) => lines.push(values.join(" "));
function F(x) { this.a = x; F.prototype = { changed: 1 }; this.c = x; }
function make(x) { const o = new F(x); return o; }
for (let t = 0; t < 2; t++) for (let i = 0; i < 2; i++) { const v = make(2); say("F", v.changed, v.a, v.c); }

let turn = 0;
function G(x) { this.a = x; if (turn === 3) G.prototype = { changed: turn }; this.c = x; }
G.prototype.first = "first";
function makeG(x) { const o = new G(x); return o; }
for (; turn < 6; turn++) for (let i = 0; i < 2; i++) { const v = makeG(i); say("G", turn, v.first, v.changed, Object.getPrototypeOf(v) === G.prototype, Object.keys(v)); }

function H(x) { this.x = x; }
H.prototype.name = "old";
const kept = [];
for (let i = 0; i < 6; i++) {
  const o = new H(i);
  if (i === 2) {
    H.prototype = { name: "new" };
    kept.push(o);
  }
  if (i === 4) kept.push(o);
}
for (const o of kept) say("H", o.x, o.name);

function K(x) { this.x = x; replace(x); this.y = x; }
K.prototype.name = "k0";
function replace(x) { if (x % 3 === 2) K.prototype = { name: "k" + x }; }
function sum(n) { let s = ""; for (let i = 0; i < n; i++) { const o = new K(i); s += o.name + o.x + o.y + " "; } return s; }
say("K", sum(7));
say("K", sum(4));

function L(x) { this.x = x; Object.defineProperty(L, "prototype", { value: { name: "l" + x }, writable: true }); this.y = 1; }
L.prototype.name = "none";
function pair(x) { return [new L(x), new L(x + 1)]; }
for (let i = 0; i < 4; i++) { const [first, second] = pair(i); say("L", first.name, second.name, first instanceof L, second instanceof L); }

const other = M;
function M(x) { this.x = x; other.prototype = Object.create({ name: "m" + x }); this.y = x; }
M.prototype.name = "m";
let last;
for (let i = 0; i < 4; i++) { const o = new M(i); last = i & 1 ? o : last; say("M", o.name, last?.name); }
console.log(lines.join("\n"));
