type Rec = { b: string };
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, "7", { get() { return 42; }, enumerable: true }); return made; }
function find(o: any): any { let v; for (const k in o) { v = o[k]; break; } return v; }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
