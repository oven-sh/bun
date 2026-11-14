// COUNTER: operationAOTDidCreateFieldAt <= 0
class Node4 { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 0; this.parent = undefined; } get pos() { return this._pos; } set pos(v) { this._pos = v; } getStart() { return this.pos; } }
function create(kind, parent) { const n = new Node4(kind, 1); n.parent = parent; return n; }
function depth(n) { let d = 0; while (n) { if (n.kind === 3) d++; d += n.flags + n.getStart(); n = n.parent; } return d; }
function run(m) { let s = 0; for (let i = 0; i < m; i++) { let p; for (let k = 0; k < 8; k++) p = create(k & 3, p); s += depth(p); } return s; }
console.log(run(1000));
