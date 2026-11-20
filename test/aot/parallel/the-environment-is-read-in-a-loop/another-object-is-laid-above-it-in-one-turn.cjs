function level() { return process.env.LOG_LEVEL || "info"; }
function home() { return process.env.MADE_UP_HOME; }
function mixed(s) { const h = home(); return (s * 31 + level().length * 7 + (h === undefined ? 1 : h.length + 2)) % 1000003; }
const said = [];
delete process.env.MADE_UP_HOME; delete process.env.LOG_LEVEL;
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = mixed(s); if (i === 9) Object.setPrototypeOf(process.env, t % 2 ? { MADE_UP_HOME: "/above" + t } : { LOG_LEVEL: "above" + t }); } return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
