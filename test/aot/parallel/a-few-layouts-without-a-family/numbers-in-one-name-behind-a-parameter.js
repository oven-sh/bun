function size(o, d) { return d ? size(o, d - 1) : o.size + 1; }
const a = { size: 1, p: "x", q: "y" }, b = { size: 2.5, s: 1 }, c = { size: 1e10, t: 2, u: 3 };
let t = 0; for (let i = 0; i < 300; i++) t += size(a, 1) + size(b, 1) + size(c, 1); console.log(t);
