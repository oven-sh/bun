type Rec = { b: string };
type Other = { c: string; d: string };
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, "zzLaidByDescriptor", { value: 42, enumerable: true }); return made; }
function makeOther(): Other { return { c: "p", d: "q" }; }
function find(o: Rec | Other): any { return Object.values(o)[1]; }
let got: any; let texts = 0; for (let i = 0; i < 300; i++) { if (typeof find(makeOther()) === "string") texts++; got = find(make()); }
console.log(texts);
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
