function read(o, d) { return d ? read(o, d - 1) : o.kind; }
const a = { kind: "a", p: "x", q: "y" }, b = { kind: "b", s: 1 }, c = { kind: "c", t: { u: 1 } };
let out = []; for (let i = 0; i < 300; i++) { if (i === 200) b.kind = 7; if (i === 250) a.kind = 1.5; if (i === 260) c.kind = true; out.push(read(a, 1)); out.push(read(b, 1)); out.push(read(c, 1)); }
console.log(out.slice(0, 3).join(), out.slice(597, 603).join(), out.slice(750, 753).join(), out.slice(-3).join(), typeof read(a, 0), typeof read(b, 2), typeof read(c, 3));
