const K = JSON.parse("[\"env\",\"made_up\",\"argv\"]");
for (let i = 0; i < 3; i++) process[K[1] + i] = i;
const said = [];
const first = process.env;
const acts = [() => 0, () => { process[K[0]] = { LOG_LEVEL: "abc" }; return 1; }, () => { process[K[0]] = first; return 2; }, () => { process[K[0]] = { MADE_UP_HOME: "/x" }; return 3; }];
const order = JSON.parse("[0,0,0,0,0,0,1,0,0,0,2,0,0,3,0,0,0,2,0,0]");
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; if (t % 2) s += acts[order[i]](); } return s; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
