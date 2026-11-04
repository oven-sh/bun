type Rec = { n: number };
function make(): any { const made = { b: "y" }; Object.defineProperty(made, "taker", { set(v: any) { v.n = "text"; } }); return made; }
function makeOther(): any { return { c: "p", taker: null }; }
function run(i: number): any { const rec: Rec = { n: i }; const holder = i % 2 ? make() : makeOther(); holder.taker = rec; return rec.n; }
let got: any; let numbers = 0; for (let i = 0; i < 300; i++) { got = run(i); if (typeof got === "number") numbers++; }
console.log(numbers);
console.log(typeof got, typeof got === "number", got === "text");
