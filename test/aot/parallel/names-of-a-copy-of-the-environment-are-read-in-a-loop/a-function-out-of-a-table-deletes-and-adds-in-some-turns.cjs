process.env.MADE_UP_HOME = "/home/made-up"; process.env.MADE_UP_LEVEL = "warn";
const K = JSON.parse("[\"env\"]");
let sum = 0;
process[K[0]] = { ...process.env }; const laid = process.env;
const acts = [() => 0, () => { delete laid.MADE_UP_HOME; return 1; }, () => { laid.MADE_UP_HOME = "/home/made-up"; return 2; }, () => { laid["GROWN_" + sum] = "x"; return 3; }];
const order = JSON.parse("[0,0,0,0,0,0,1,0,0,0,2,0,0,3,0,0,0,1,0,2]");
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.MADE_UP_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; if (t % 2) s += acts[order[i]](); } return s; }
const rounds = Number(process.argv[2] ?? 40);
for (let t = 0; t < rounds; t++) sum = (sum * 31 + f(t)) % 1000003;
console.log(sum);
