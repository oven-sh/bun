process.env.MADE_UP_HOME = "/home/made-up"; process.env.MADE_UP_LEVEL = "warn";
const K = JSON.parse("[\"env\"]");
let sum = 0;
const first = { ...process.env };
delete process.env.MADE_UP_HOME; process.env.MADE_UP_EARLY = "early"; process.env.MADE_UP_HOME = "/second";
const second = { ...process.env };
const third = Object.assign({ MADE_UP_LEVEL: "own" }, process.env);
const all = [first, second, third, first, third, second];
function f(t) { process[K[0]] = all[Math.floor(t / 6) % all.length]; let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.MADE_UP_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } return s; }
const rounds = Number(process.argv[2] ?? 40);
for (let t = 0; t < rounds; t++) sum = (sum * 31 + f(t)) % 1000003;
console.log(sum);
