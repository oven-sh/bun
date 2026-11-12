function level() { return process.env.LOG_LEVEL || "info"; }
function home() { return process.env.MADE_UP_HOME; }
function mixed(s) { const h = home(); return (s * 31 + level().length * 7 + (h === undefined ? 1 : h.length + 2)) % 1000003; }
const said = [];
function f(t) { let s = t; process.env.MADE_UP_HOME = "/home"; process.env.LOG_LEVEL = "warning"; for (let i = 0; i < 20; i++) { s = mixed(s); if (i === 7) delete process.env.LOG_LEVEL; if (i === 13) delete process.env.MADE_UP_HOME; } return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
