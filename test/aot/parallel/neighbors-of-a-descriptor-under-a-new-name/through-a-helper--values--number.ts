type Rec = { b: string };
function lay(o: object, name: string, how: PropertyDescriptor) { Object.defineProperty(o, name, how); }
function make(): Rec { const made: Rec = { b: "y" }; lay(made, "zzLaidByDescriptor", { value: 42, enumerable: true }); return made; }
function find(o: any): any { const all = Object.values(o); return all[all.length - 1]; }
let got: any; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
