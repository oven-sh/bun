class Base { constructor(a) { this.a = a; } who() { return "base"; } sum() { return this.a; } }
class Middle extends Base { constructor(a, b) { super(a); this.b = b; } who() { return "middle"; } sum() { return super.sum() + this.b; } }
class Kind extends Middle { constructor(a, b, c) { super(a, b); this.c = c; } who() { return "kind"; } sum() { return super.sum() + this.c; } }
function show(o) { console.log(o.who(), o.sum(), Object.keys(o).join(), o.constructor.name, o instanceof Kind, o instanceof Middle, o instanceof Base, Object.getPrototypeOf(o) === Middle.prototype, JSON.stringify(o)); }
show(new Kind(1, 2, 3));
const table = {};
for (const [name, f] of [["a", x => x], ["b", function (x) { return x; }], ["c", Middle], ["d", Kind], ["e", Math.max], ["f", class { who() { return "none"; } sum() { return 0; } }]]) table[name] = f;
show(new table.c(4, 5));
show(new table["d"](4, 5, 6));
console.log(table.a(1), table.b(2), table.e(3, 4));
