function make() { const made = { b: "y" }; Object.defineProperty(made, "taker", { set: function (v) { v.n = "text"; } }); return made; }
function run(i) { const rec = { n: i }; const holder = make(); holder.taker = rec; return rec.n; }
let got; for (let i = 0; i < 300; i++) got = run(i);
console.log(typeof got, typeof got === "number", got === "text");
