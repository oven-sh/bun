function size(o, d) { return d ? size(o, d - 1) : o.size + 1; }
const a = { size: 1, p: "x", q: "y", r: "z" }, b = { size: 2, s: 1 }, c = { size: 3, t: 2, u: 3 };
let t = 0; for (let i = 0; i < 300; i++) { if (i === 150) b.size = 2 ** 40; if (i === 200) c.size = "text"; if (i === 250) a.size = undefined; t = t + size(a, 1) + size(b, 1) + size(c, 1); } console.log(String(t).slice(0, 60));
