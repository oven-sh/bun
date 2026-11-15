const said = [];
process.env.MADE_UP_HOME = "/home"; process.env.LOG_LEVEL = "warning";
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } if (t === 1) delete process.env.MADE_UP_HOME; if (t === 3) delete process.env.LOG_LEVEL; return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
