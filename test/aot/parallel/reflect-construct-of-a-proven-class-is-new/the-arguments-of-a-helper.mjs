class P { constructor(x, y) { this.x = x; this.y = y; this.n = arguments.length; } }
function make() { return Reflect.construct(P, arguments); }
function strict() { "use strict"; return Reflect.construct(P, arguments); }
const a = make(1, 2), b = make(), c = make(1, 2, 3), d = strict(7);
console.log(a.x, a.y, a.n, "|", b.x, b.y, b.n, "|", c.x, c.y, c.n, "|", d.x, d.y, d.n);
