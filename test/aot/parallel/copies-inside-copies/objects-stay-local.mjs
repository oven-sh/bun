const attempt = f => { try { return f(); } catch (e) { return e.name; } };
class Node { constructor(x, next) { this.x = x; this.next = next; } }
class List { constructor() { this.head = null; this.size = 0; } push(x) { this.head = new Node(x, this.head); this.size++; return this; } pop() { const n = this.head; this.head = n.next; this.size--; return n.x; } sum() { let t = 0; for (let n = this.head; n; n = n.next) t += n.x; return t; } }
class V { constructor(x, y) { this.x = x; this.y = y; } add(o) { return new V(this.x + o.x, this.y + o.y); } scale(f) { return new V(this.x * f, this.y * f); } dot(o) { return this.x * o.x + this.y * o.y; } kept() { saved = this; return this; } }
let saved = null;
function build(i) { return new List().push(i).push(2).push(3); }
function sized(i) { return build(i).size + build(i).pop() + build(i).sum(); }
function vectors(a, i) { return a.add(new V(i, 1)).scale(2).dot(a); }
function escapes(i) { const v = new V(i, 2).add(new V(1, 1)).kept(); return v.x + saved.y; }
function throws(i) { const l = new List().push(i); if (i === 77) l.pop(), l.pop(); return l.pop(); }
function pair(i) { return { a: i, b: [i, i + 1], get c() { return this.a + 1; } }; }
function reads(i) { const p = pair(i); return p.a + p.b.length + p.c; }
function options({ a = 1, b = 2 } = {}) { return new V(a, b); }
function optional(i) { return options(i & 1 ? { a: i } : undefined).x + options({ b: i }).y; }
function same(i) { const v = new V(i, i); return v.add(v) === v ? 1 : v.add(v).dot(v); }
function identity(i) { const l = new List(); return l.push(i) === l ? l.push(i).size : -1; }
class Runner { constructor() { this.total = 0; this.v = new V(1, 2); } one(i) { this.total += sized(i) + vectors(this.v, i) + reads(i) + optional(i) + same(i) + identity(i); return this; } two(i) { this.total += escapes(i) + (attempt(() => throws(i)) === "TypeError" ? 1000 : 1); return this; } run(n) { for (let i = 0; i < n; i++) this.one(i).two(i); return this.total; } }
console.log(new Runner().run(300), saved.x, saved.y);
List.prototype.push = function (x) { this.head = { x, next: this.head }; this.size += 10; return this; };
console.log(new Runner().run(50));
V.prototype.add = function (o) { return Object.freeze({ x: 1, y: 2, scale: f => ({ dot: () => f }), kept() { saved = this; return this; }, dot: () => 3 }); };
console.log(new Runner().run(50), saved.x);
