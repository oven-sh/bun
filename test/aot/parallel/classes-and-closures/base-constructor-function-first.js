// Base constructor for a function with its first prototype.
class A { constructor() { this.x = 1; this.seen = this.m(); } m() { return "A.m"; } }
function F() { this.f = 1; }
F.prototype.m = function () { return "F.m"; };
function read(o) { return o.extra + " " + o.x + " " + o.seen + " " + o.m() + " " + (o instanceof A) + " " + (o instanceof F); }
const a = new A(), f = new F();
const o = Reflect.construct(A, [], F);
o.extra = 7;
console.log(read(a)); console.log(read(o)); console.log(f.m(), f.f, Object.keys(o).join());
