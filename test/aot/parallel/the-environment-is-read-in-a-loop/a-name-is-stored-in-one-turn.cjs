function level() { return process.env.LOG_LEVEL || "info"; }
function home() { return process.env.MADE_UP_HOME; }
function mixed(s) { const h = home(); return (s * 31 + level().length * 7 + (h === undefined ? 1 : h.length + 2)) % 1000003; }
const said = [];
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = mixed(s); if (i === 7) process.env.LOG_LEVEL = "l".repeat(t % 4 + 1); if (i === 13 && t % 2) process.env.MADE_UP_HOME = "/h" + t; } return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
