class Point { constructor(kind, pos) { this.pos = pos; this.kind = kind; this.flags = 0; this.next = undefined; } get pos() { return this._pos; } set pos(value) { this._pos = value; } getStart() { return this.pos; } }
class Range { get start() { return this._start; } set start(value) { this._start = value; this.changes = 1; } get end() { return this._end; } set end(value) { if (value > this._start) this._end = value; } constructor(start, end) { this.name = "r"; this.start = start; this.end = end; this.last = 1; } }
class Below extends Point { set pos(value) { this.other = value; } get pos() { return this.other; } constructor(kind) { super(kind, kind + 1); this.below = true; } }
class Later { constructor(x) { this.x = x; this._y = 1; this.y = 2; } set x(value) { this._y = value; this._x = value; } get x() { return this._x; } set y(value) { this._y += value; } get y() { return this._y; } }
class Twice { constructor(x) { this.x = x; this.z = 0; this.x = x + 1; } set x(value) { this.x2 = value; this.z = value; } }
class Throws { constructor(x) { try { this.x = x; } catch (error) { this.error = error.message; } this.y = 1; } set x(value) { this.before = 1; if (value > 1) throw new Error("no"); this._x = value; } }
class Self { constructor(x) { this.x = x; this.y = 1; } set x(value) { Object.defineProperty(this, "x", { value, writable: true, enumerable: true }); this.z = 2; } }
class Arrow { constructor(x) { this.x = x; this.y = 1; } set x(value) { const keep = () => { this.kept = value; }; if (value) keep(); this._x = value; } }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let point; for (let k = 0; k < 8; k++) { const made = new Point(k & 3, 1); made.next = point; point = made; } for (; point; point = point.next) sum += point.flags + point.getStart() + point.kind; } return sum; }
console.log(run(100));
for (const made of [new Point(1, 2), new Range(1, 2), new Range(2, 1), new Below(1), new Later(3), new Twice(4), new Throws(1), new Throws(2), new Self(5), new Arrow(0), new Arrow(1)])
  console.log(made.constructor.name, Object.keys(made).join(), JSON.stringify(made));
const again = new Point(1, 2);
again.pos = 5;
again.extra = 1;
console.log(Object.keys(again).join(), again.getStart());
Object.defineProperty(Point.prototype, "pos", { set(value) { this.hidden = value; }, get() { return this.hidden; } });
console.log(Object.keys(new Point(1, 2)).join(), new Point(1, 2).getStart(), run(10));
