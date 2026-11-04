class Base { constructor(a) { this.a = a; } who() { return "base"; } sum() { return this.a; } }
class Middle extends Base { constructor(a, b) { super(a); this.b = b; } who() { return "middle"; } sum() { return super.sum() + this.b; } }
class Kind extends Middle { constructor(a, b, c) { super(a, b); this.c = c; } who() { return "kind"; } sum() { return super.sum() + this.c; } }
function show(o) { console.log(o.who(), o.sum(), Object.keys(o).join(), o.constructor.name, o instanceof Kind, o instanceof Middle, o instanceof Base, Object.getPrototypeOf(o) === Middle.prototype, JSON.stringify(o)); }
show(new Kind(1, 2, 3));
function below(C) { return class extends C { who() { return "made " + super.who(); } }; }
show(new (below(Middle))(4, 5));
show(new (below(below(Middle)))(6, 7));
