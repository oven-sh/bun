const said = [];
function f(t) { let s = t; for (let i = 0; i < 20; i++) { if ((i + t) % 3 === 0) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } else s += 1; if (i === 10) process.env.LOG_LEVEL = t % 2 ? "info" : "warn"; } return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
