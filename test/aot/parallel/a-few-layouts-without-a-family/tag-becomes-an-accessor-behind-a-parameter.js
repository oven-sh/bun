function read(o, d) { return d ? read(o, d - 1) : o.kind; }
const a = { kind: "a", p: "x", q: "y" }, b = { kind: "b", s: 1 }, c = { kind: "c", t: { u: 1 } }; let reads = 0;
let out = []; for (let i = 0; i < 300; i++) { if (i === 100) Object.defineProperty(b, "kind", { get() { reads++; return "got"; }, configurable: true }); out.push(read(a, 1)); out.push(read(b, 1)); out.push(read(c, 1)); }
console.log(out.slice(297, 303).join(), out.slice(-3).join(), reads);
