class First { constructor() { this.first = 1; } m() { return "First.m"; } }
class A { constructor() { this.x = 1; this.seen = this.m(); } m() { return "A.m"; } }
class B extends First { s = 5; m() { return "B.m " + super.m(); } }
Object.setPrototypeOf(B, A);
function read(o) { return o.first + " " + o.x + " " + o.s + " " + o.seen + " " + o.m() + " " + (o instanceof A) + " " + (o instanceof B) + " " + (o instanceof First); }
console.log(read(new A())); console.log(read(new First())); console.log(read(new B())); console.log(Object.keys(new B()).join());
