class P { constructor(x) { this.x = x; this.made = new.target.name; } who() { return "P"; } }
class Q { who() { return "Q"; } }
class R extends P { who() { return "R"; } }
const a = Reflect.construct(P, [1], Q), b = Reflect.construct(P, [2], R), c = Reflect.construct(R, [3], P), d = Reflect.construct(P, [4], P);
console.log(a.x, a.made, a.who(), a instanceof P, a instanceof Q, "|", b.x, b.made, b.who(), "|", c.x, c.made, c.who(), c instanceof R, "|", d.x, d.made, d.who());
