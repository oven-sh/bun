function level() { return process.env.LOG_LEVEL || "info"; }
function home() { return process.env.MADE_UP_HOME; }
function mixed(s) { const h = home(); return (s * 31 + level().length * 7 + (h === undefined ? 1 : h.length + 2)) % 1000003; }
const said = [];
function zone() { const z = process.env.TZ; return z === undefined ? 1 : z.length; }
function f(t) { let s = t; for (let i = 0; i < 20; i++) s = (mixed(s) + zone()) % 1000003; process.env.TZ = t % 2 ? "Asia/Tokyo" : "America/New_York"; return s + new Date(0).getHours(); }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
