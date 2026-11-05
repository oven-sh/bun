function read(o, d) { return d ? read(o, d - 1) : o.kind; }
const a = { kind: "a", p: "x", q: "y" }, b = { kind: "b", s: 1 }, c = { kind: "c", t: { u: 1 } };
let out = []; for (let i = 0; i < 300; i++) { if (i === 100) b.kind = undefined; if (i === 150) a.kind = null; if (i === 200) b.kind = "again"; out.push(String(read(a, 1))); out.push(String(read(b, 1))); out.push(String(read(c, 1))); }
console.log(out.slice(297, 303).join(), out.slice(450, 453).join(), out.slice(-3).join());
