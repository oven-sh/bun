type Rec = { n: number };
type Holder = { b: string };
function make(): Holder { const made: Holder = { b: "y" }; Object.defineProperties(made, { taker: { set(v: any) { v.n = "text"; } } }); return made; }
function run(i: number): any { const rec: Rec = { n: i }; const holder: any = make(); holder.taker = rec; return rec.n; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
