type Rec = { n: number };
type Holder = { b: string };
let taken = 0;
function make(): Holder { const made: Holder = { b: "y" }; Object.defineProperty(made, "taker", { set(v: any) { taken += v; } }); return made; }
function run(i: number): number { const rec: Rec = { n: i }; const holder: any = make(); holder.taker = 2; return rec.n + holder.b.length; }
let sum = 0; for (let i = 0; i < 300; i++) sum += run(i);
console.log(sum, taken);
