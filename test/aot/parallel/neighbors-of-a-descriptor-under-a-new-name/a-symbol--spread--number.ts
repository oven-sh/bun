type Rec = { b: string };
const mark = Symbol("zz");
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, mark, { value: 42, enumerable: true }); return made; }
function find(o: any): any { const copy: any = { ...o }; return copy[Object.getOwnPropertySymbols(copy)[0]]; }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
