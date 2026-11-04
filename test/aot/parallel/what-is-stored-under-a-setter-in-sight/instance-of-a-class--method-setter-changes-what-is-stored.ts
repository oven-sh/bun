type Rec = { n: number };
class Holder { b = "y"; constructor() { Object.defineProperty(this, "taker", { set(v: any) { v.n = "text"; } }); } }
function run(i: number): any { const rec: Rec = { n: i }; const holder: any = new Holder(); holder.taker = rec; return rec.n; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
