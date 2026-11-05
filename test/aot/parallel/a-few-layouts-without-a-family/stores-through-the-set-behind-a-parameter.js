function rename(o, to, d) { if (d) return rename(o, to, d - 1); o.kind = to; return o.kind; }
const a = { kind: "a", p: "x", q: "y" }, b = { kind: "b", s: 1 }, c = { kind: "c", t: { u: 1 } };
let out = []; for (let i = 0; i < 300; i++) { const to = i < 100 ? "t" + (i & 3) : i < 200 ? i : i & 2 ? null : { n: i }; out.push(rename(a, to, 1)); out.push(rename(b, to, 1)); out.push(rename(c, to, 1)); }
console.log(out.slice(0, 3).join(), out.slice(297, 303).join(), JSON.stringify(out.slice(-6)), JSON.stringify([a.kind, b.kind, c.kind]));
