type Rec = { n: number };
type Holder = { b: string };
let kept: any;
function make(): Holder { const made: Holder = { b: "y" }; Object.defineProperty(made, "taker", { set(v: any) { kept = v; } }); return made; }
function run(i: number): any { const rec: Rec = { n: i }; const holder: any = make(); holder.taker = rec; kept.n = "text"; return rec.n; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
