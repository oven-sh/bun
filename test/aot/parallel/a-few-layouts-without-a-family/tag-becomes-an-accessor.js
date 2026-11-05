function name(o) { return o.kind; }
const a = { kind: "a", p: "x", q: "y", r: "z" }, b = { kind: "b", s: 1 }; let reads = 0;
let out = []; for (let i = 0; i < 300; i++) { if (i === 100) Object.defineProperty(b, "kind", { get() { reads++; return "got"; }, configurable: true }); out.push(name(i & 1 ? a : b)); }
console.log(out[98], out[99], out[100], out[101], out[298], reads);
