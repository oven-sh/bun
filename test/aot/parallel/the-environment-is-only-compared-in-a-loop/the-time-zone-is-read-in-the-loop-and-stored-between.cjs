const said = [];
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; s += process.env.TZ === "Asia/Tokyo" ? 7 : 11; } process.env.TZ = t % 2 ? "Asia/Tokyo" : "America/New_York"; return s + new Date(0).getHours(); }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
