class Base { constructor(a) { this.a = a; } who() { return "base"; } sum() { return this.a; } }
class Middle extends Base { constructor(a, b) { super(a); this.b = b; } who() { return "middle"; } sum() { return super.sum() + this.b; } }
class Kind extends Middle { constructor(a, b, c) { super(a, b); this.c = c; } who() { return "kind"; } sum() { return super.sum() + this.c; } }
function show(o) { console.log(o.who(), o.sum(), Object.keys(o).join(), o.constructor.name, o instanceof Kind, o instanceof Middle, o instanceof Base, Object.getPrototypeOf(o) === Middle.prototype, JSON.stringify(o)); }
show(new Kind(1, 2, 3));
function apply(f, construct, ...list) { return construct ? new f(...list) : f(...list); }
console.log(apply(Math.min, false, 3, 4), apply(x => x + 1, false, 1), apply(String, false, 5));
show(apply(Kind, true, 1, 2, 3));
show(apply(Middle, true, 4, 5));
