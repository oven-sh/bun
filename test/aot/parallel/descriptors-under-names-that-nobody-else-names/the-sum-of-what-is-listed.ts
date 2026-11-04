type Rec = { b: number };
function make(n: number): Rec { const made: Rec = { b: n }; Object.defineProperty(made, "zzLaidByDescriptor", { value: "text", enumerable: true }); return made; }
function sum(o: Rec): any { let t: any = 0; for (const v of Object.values(o)) t += v; return t; }
let got: any; for (let i = 0; i < 300; i++) got = sum(make(i));
console.log(typeof got, got);
