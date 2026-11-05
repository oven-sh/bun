function read(o, d) { return d ? read(o, d - 1) : o.kind; }
function make(i) { return i < 50 ? { kind: "early", p: "x", q: "y" } : { kind: i, p: "x", q: "y" }; }
const b = { kind: "b", s: 1 };
let out = []; for (let i = 0; i < 100; i++) { out.push(read(make(i), 1)); out.push(read(b, 1)); }
console.log(out.slice(96, 104).join(), out.slice(-2).join());
