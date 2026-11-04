function Holder() { this.b = "y"; }
Object.defineProperty(Holder.prototype, "taker", { set(v) { v.n = "text"; } });
function run(i) { const rec = { n: i }; const holder = new Holder(); holder.taker = rec; return rec.n; }
let got; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
