function id(x) { return x; }
const a = id({ a: 1 }), b = id({ b: "two" }), c = id({ a: 3.5, c: null });
console.log(a.a, a.b, a.c, b.a, b.b, c.a, c.c, c.b);
console.log(JSON.stringify([a, b, c]), Object.keys(a), Object.keys(c), "b" in a, "b" in b);
