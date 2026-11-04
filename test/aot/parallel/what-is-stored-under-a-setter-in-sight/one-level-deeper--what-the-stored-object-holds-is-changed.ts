type Rec = { n: number };
type Outer = { inner: Rec };
type Holder = { b: string };
function make(): Holder { const made: Holder = { b: "y" }; Object.defineProperty(made, "taker", { set(v: any) { v.inner.n = "text"; } }); return made; }
function run(i: number): any { const rec: Rec = { n: i }; const outer: Outer = { inner: rec }; const holder: any = make(); holder.taker = outer; return rec.n; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
