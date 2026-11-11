const host = process.env;
const name = (text, value) => { delete host[text]; if (value !== undefined) host[text] = value; };
let laid;
function lay(copy) { laid = copy; return 1; }
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (laid.MADE_UP_HOME === undefined ? 1 : 2) + ((laid.MADE_UP_LEVEL || "info") === "info" ? 3 : 5) + (laid.MADE_UP_HOME === "/a" ? 7 : 0)) % 1000003; } return s; }
name("MADE_UP_HOME", "/a"); name("MADE_UP_LEVEL", "warn"); const one = { ...host }; const two = { ...host }; two.MADE_UP_LEVEL = "info";
const all = [one, two];
let sum = 0; const rounds = Number(process.argv[2] ?? 60);
for (let t = 0; t < rounds; t++) { const copy = all[t % 2]; sum += lay(copy); sum = (sum * 31 + f(t)) % 1000003; if (t % 4 === 1 && t < 200) for (let k = 0; k < 5; k++) copy["GROWN_" + t + "_" + k] = "g"; sum = (sum * 31 + f(t + 1)) % 1000003; }
console.log(sum);
