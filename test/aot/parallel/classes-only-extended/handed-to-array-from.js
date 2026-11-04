class Base { constructor(a) { this.a = a; } who() { return "base"; } sum() { return this.a; } }
class Middle extends Base { constructor(a, b) { super(a); this.b = b; } who() { return "middle"; } sum() { return super.sum() + this.b; } }
class Kind extends Middle { constructor(a, b, c) { super(a, b); this.c = c; } who() { return "kind"; } sum() { return super.sum() + this.c; } }
function show(o) { console.log(o.who(), o.sum(), Object.keys(o).join(), o.constructor.name, o instanceof Kind, o instanceof Middle, o instanceof Base, Object.getPrototypeOf(o) === Middle.prototype, JSON.stringify(o)); }
show(new Kind(1, 2, 3));
for (const o of Array.from([Kind, Middle], C => new C(4, 5, 6))) show(o);
