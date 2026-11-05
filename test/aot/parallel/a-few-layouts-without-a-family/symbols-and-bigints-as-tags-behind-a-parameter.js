function read(o, d) { return d ? read(o, d - 1) : o.kind; }
const mark = Symbol("mark"); const a = { kind: mark, p: "x", q: "y" }, b = { kind: 10n, s: 1 }, c = { kind: "c", t: { u: 1 } };
let out = []; for (let i = 0; i < 100; i++) { out.push(read(a, 1) === mark); out.push(read(b, 1) === 10n); out.push(read(c, 1)); } console.log(out.slice(-3).join(), typeof read(a, 1), typeof read(b, 1));
