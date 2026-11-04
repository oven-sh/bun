type Rec = { b: string };
const hiddenName: string = (0, eval)("'zzLaid' + 'ByDescriptor'");
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, hiddenName, { get() { return 42; }, enumerable: true }); return made; }
function find(o: any): any { let v; for (const k in o) v = o[k]; return v; }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
