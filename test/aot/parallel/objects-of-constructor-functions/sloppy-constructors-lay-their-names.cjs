function show(o) { var k = []; for (var i in o) k.push(i); return Object.keys(o).join() + "|" + k.join() + "|" + JSON.stringify(o) + "|" + Object.prototype.hasOwnProperty.call(o, "a") + "|" + o.a + "|" + Object.keys(Object.assign({}, o)).join(); }
function Plain(a, b) { this.a = a; this.b = b; }
function ReadsFirst(a) { this.b = this.a; this.a = a; this.c = this.a; }
function Early(a) { this.a = a; if (a === 1) return; this.b = 2; }
function Ordered(a) { if (a & 1) { this.x = 1; this.a = a; } else { this.a = a; this.x = 1; } this.z = 3; }
function Returns(a) { this.a = a; if (a === 1) return { other: 1 }; this.b = 1; }
function Sealed(a) { this.a = a; if (a) Object.freeze(this); this.a = 7; this.b = 6; }
function Fixed(a) { Object.defineProperty(this, "a", { value: 1 }); this.a = a; this.b = 6; }
function Forbidden(a) { this.a = a; this.b = 1; }
Forbidden.prototype = Object.freeze({ a: 4, constructor: Forbidden });
function Guarded(a) { if (!(this instanceof Guarded)) return new Guarded(a); this.a = a; }
var kept;
function Handed(a) { kept = this; this.b = look(); this.a = a; }
function look() { return kept.a; }
function Node(a, next) { this.a = a; this.next = next; this.k = 0; }
Node.prototype.sum = function () { var s = 0; for (var p = this; p; p = p.next) s += p.a + p.k; return s; };
for (var r = 0; r < 3; r++) {
  for (var C of [Plain, ReadsFirst, Early, Ordered, Returns, Sealed, Fixed, Forbidden, Guarded, Handed]) console.log(C.name, show(new C(r, "x")), show(new C(-0)), show(new C(0.5)));
  var other = { c: 1 }, below = Object.create(Plain.prototype);
  Plain.call(other, r, 2); Plain.call(below, r, 3); console.log(show(other), show(below), show(Guarded(r)));
  var l = null; for (var i = 0; i < 50; i++) l = new Node(i + r, l); console.log(l.sum());
}
