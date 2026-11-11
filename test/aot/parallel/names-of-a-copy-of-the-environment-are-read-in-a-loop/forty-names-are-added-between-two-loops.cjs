process.env.MADE_UP_HOME = "/home/made-up"; process.env.MADE_UP_LEVEL = "warn";
const K = JSON.parse("[\"env\"]");
let sum = 0;
process[K[0]] = { ...process.env }; const laid = process.env;
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.MADE_UP_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } if (t === 3 || t === 11) for (let k = 0; k < 40; k++) laid["MORE_" + t + "_" + k] = String(k); return s; }
const rounds = Number(process.argv[2] ?? 40);
for (let t = 0; t < rounds; t++) sum = (sum * 31 + f(t)) % 1000003;
console.log(sum);
