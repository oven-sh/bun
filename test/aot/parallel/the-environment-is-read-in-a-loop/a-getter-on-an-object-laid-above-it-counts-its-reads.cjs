function level() { return process.env.LOG_LEVEL || "info"; }
function home() { return process.env.MADE_UP_HOME; }
function mixed(s) { const h = home(); return (s * 31 + level().length * 7 + (h === undefined ? 1 : h.length + 2)) % 1000003; }
const said = [];
let calls = 0;
delete process.env.MADE_UP_HOME;
Object.setPrototypeOf(process.env, { get MADE_UP_HOME() { calls++; return "/g".repeat(calls % 3 + 1); } });
function f(t) { let s = t; for (let i = 0; i < 20; i++) s = mixed(s); return s + calls; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
