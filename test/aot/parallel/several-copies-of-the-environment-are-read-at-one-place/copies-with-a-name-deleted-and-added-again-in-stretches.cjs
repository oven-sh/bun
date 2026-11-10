const host = process.env;
const name = (text, value) => { delete host[text]; if (value !== undefined) host[text] = value; };
let laid;
function lay(copy) { laid = copy; return 1; }
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (laid.MADE_UP_HOME === undefined ? 1 : 2) + ((laid.MADE_UP_LEVEL || "info") === "info" ? 3 : 5) + (laid.MADE_UP_HOME === "/a" ? 7 : 0)) % 1000003; } return s; }
name("MADE_UP_HOME", "/a"); name("MADE_UP_LEVEL", "warn"); const one = { ...host }; const two = { ...host };
const N = JSON.parse("[\"MADE_UP_HOME\",\"MADE_UP_LEVEL\",\"MADE_UP_OTHER\"]");
delete two[N[0]]; two[N[0]] = "/b";
const three = { ...host }; delete three[N[1]]; three[N[2]] = "o"; three[N[1]] = "info";
const all = [one, two, three];
let sum = 0; const rounds = Number(process.argv[2] ?? 60);
for (let t = 0; t < rounds; t++) { sum += lay(all[Math.floor(t / 5) % all.length]); sum = (sum * 31 + f(t)) % 1000003; }
console.log(sum);
