function read(o, d) { return d ? read(o, d - 1) : o.kind; }
const a = { kind: "a", p: 1 }, b = { q: 2, kind: "b" }, c = { r: 3, s: 4, kind: "c" };
let out = ""; for (let i = 0; i < 300; i++) out = read(a, 1) + read(b, 1) + read(c, 1) + out.slice(0, 3);
console.log(out);
