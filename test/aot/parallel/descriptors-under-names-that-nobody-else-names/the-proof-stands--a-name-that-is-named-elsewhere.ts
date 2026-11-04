type Rec = { b: string };
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, "zzNamedElsewhere", { value: 42, enumerable: true }); return made; }
function read(o: any): any { return o.zzNamedElsewhere; }
function find(o: any): any { return Object.values(o)[1]; }
let got: any; let named: any; for (let i = 0; i < 300; i++) { const made = make(); got = find(made); named = read(made); }
console.log(named);
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
