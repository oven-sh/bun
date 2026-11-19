function level() { return process.env.LOG_LEVEL || "info"; }
function home() { return process.env.MADE_UP_HOME; }
function mixed(s) { const h = home(); return (s * 31 + level().length * 7 + (h === undefined ? 1 : h.length + 2)) % 1000003; }
const said = [];
const acts = [() => 0, () => { process.env.LOG_LEVEL = "abc"; return 1; }, () => { delete process.env.LOG_LEVEL; return 2; }, () => { process.env.MADE_UP_HOME = "/x"; return 3; }];
const order = JSON.parse("[0,0,0,0,0,0,1,0,0,0,2,0,0,3,0,0,0,0,0,0]");
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = mixed(s); if (t % 2) s += acts[order[i]](); } return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
