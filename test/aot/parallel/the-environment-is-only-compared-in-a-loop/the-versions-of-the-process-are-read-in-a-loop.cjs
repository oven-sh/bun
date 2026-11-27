const said = [];
function f(t) { let s = t; for (let i = 0; i < 20; i++) s = (s * 31 + (process.versions.made_up === undefined ? 1 : 2) + (process.versions.bun === undefined ? 3 : 5) + (process.release.name === "node" ? 7 : 11)) % 1000003; return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
