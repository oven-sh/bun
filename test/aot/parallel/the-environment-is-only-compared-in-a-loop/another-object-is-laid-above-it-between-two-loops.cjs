const said = [];
delete process.env.MADE_UP_HOME; delete process.env.LOG_LEVEL;
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } Object.setPrototypeOf(process.env, t % 2 ? { MADE_UP_HOME: "/above" + t } : { LOG_LEVEL: "above" + t }); return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
