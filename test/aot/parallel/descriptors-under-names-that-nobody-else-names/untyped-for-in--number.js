function make() { const made = { b: "y" }; Object.defineProperty(made, "zzLaidByDescriptor", { value: 42, enumerable: true }); return made; }
function find(o) { let v; for (const k in o) v = o[k]; return v; }
let got; for (let i = 0; i < 300; i++) got = find(make());
console.log(typeof got, typeof got === "number", got === 42, typeof got === "object" && got !== null ? got.deep : "-", typeof got === "function" ? got("a") : "-");
