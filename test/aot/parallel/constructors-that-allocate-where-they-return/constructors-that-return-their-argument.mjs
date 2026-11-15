// A constructor may return an object that its caller has made and names: it is that object, whatever was stored into it since it was made.
class Point { constructor(x, late) { this.x = x; if (late) this.y = late; } }
class Same { constructor(object) { return object; } }
class Counting { constructor(object) { this.unused = 1; object.x++; return object; } }
class Late { constructor() { } fill(x) { this.q = x; this.r = x + 1; return this; } }
class Base { a; constructor(x) { this.a = x; } }
class Chosen extends Base { b; constructor(x, object) { super(x); if (object) return object; this.b = 1; } }
class Holder { constructor() { const point = new Point(1); point.owner = this; this.point = point; point.y = 4; return point; } }
class Inner { constructor(x) { const point = new Point(x); point.y = x; const same = new Same(point); same.y++; this.same = point === same; this.y = point.y; } }
function direct(n) { const a = new Point(n, 0); a.y = 2; const b = new Same(a); return [a === b, b.y, a.y, Object.keys(a).join()].join(); }
function counting(n) { const a = new Point(n); a.y = n; const b = new Counting(a); b.y++; return [a === b, b.y, a.y, a.x, Object.keys(b).join()].join(); }
function loop(n) { let same = 0; for (let i = 0; i < n; i++) { const a = new Point(i); a.y = i; const b = new Same(a); b.y += 5; if (a === b && a.y === i + 5) same++; } return same; }
function late(n) { const a = new Late(); a.q = n; a.r = n; const b = new Same(a); b.q++; return [a === b, a.q, b.q].join(); }
function filled(n) { const a = new Late().fill(n); const b = new Same(a); b.r = 9; return [a === b, a.r, b.r].join(); }
function chosen(n) { const a = new Late(); a.q = n; const b = new Chosen(1, a); a.r = 5; return [a === b, b.r, b.q, Object.keys(b).join()].join(); }
function joined(n) { let text = ""; for (let i = 0; i < n; i++) { const a = new Late(); a.q = i; const b = new Same(a); b.r = i * 2; text += (a === b) + "" + a.r + b.q; } return text; }
function literal(n) { const a = { x: n }; a.y = n + 1; const b = new Same(a); b.x = 7; return [a === b, a.x, b.y].join(); }
console.log(direct(1), counting(3), loop(10), late(1), filled(2), chosen(3), joined(4), literal(5));
const holder = new Holder(); console.log(holder.owner.point === holder, Object.keys(holder).join(), Object.keys(holder.owner).join());
const inner = new Inner(6); console.log(inner.same, inner.y, new Point(1, 2).y, new Chosen(2).b);
