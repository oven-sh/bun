const o = { a: 1, b: 2, c: 3 }, p = { a: 1, b: 2, c: 3 };
const d = { get() { this.c = "text"; return "text"; } };
function act() { Object.defineProperty(o, "a", d); Object.defineProperty(p, "b", d); }
act();
console.log(typeof o.c, typeof p.c, typeof o.a, typeof o.b, typeof p.a, typeof p.b, typeof o.c, typeof p.c);
