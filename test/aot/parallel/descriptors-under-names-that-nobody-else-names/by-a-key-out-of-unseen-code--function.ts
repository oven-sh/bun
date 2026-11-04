type Rec = { b: string };
function make(): Rec { const made: Rec = { b: "y" }; Object.defineProperty(made, "zzLaidByDescriptor", { value: function hidden(x) { return 42; }, enumerable: true }); return made; }
const key: string = (0, eval)("'zzLaid' + 'ByDescriptor'");
function find(o: any): any { return o[key]; }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
