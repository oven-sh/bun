type Rec = { n: number };
type Holder = { b: string; behind: any };
function make(): Holder { const made: Holder = { b: "y", behind: null }; Object.defineProperty(made, "taker", { set(v: any) { (this as any).behind = v; } }); return made; }
function run(i: number): any { const rec: Rec = { n: i }; const holder: any = make(); holder.taker = rec; holder.behind.n = "text"; return rec.n; }
let got: any; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
