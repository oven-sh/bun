type Rec = { n: number };
type Holder = { b: string };
const unseen: (v: any) => void = (0, eval)("(v) => { v.n = 'text'; }");
function make(): Holder { const made: Holder = { b: "y" }; Object.defineProperty(made, "taker", { set(v: any) { unseen(v); } }); return made; }
function run(i: number): any { const rec: Rec = { n: i }; const holder: any = make(); holder.taker = rec; return rec.n; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
