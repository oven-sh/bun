const said = [];
globalThis.madeUpSettings = { mode: "a", depth: undefined };
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (globalThis.madeUpSettings.mode === "a" ? 1 : 2) + (globalThis.madeUpSettings.depth === undefined ? 3 : 5)) % 1000003; if (i === 6) globalThis.madeUpSettings.mode = t % 2 ? "a" : "b"; if (i === 12 && t === 3) globalThis.madeUpSettings = { mode: "c", depth: 4 }; } return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
