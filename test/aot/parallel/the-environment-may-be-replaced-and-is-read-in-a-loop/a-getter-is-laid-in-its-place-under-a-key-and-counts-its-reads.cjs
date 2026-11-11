const K = JSON.parse("[\"env\",\"made_up\",\"argv\"]");
for (let i = 0; i < 3; i++) process[K[1] + i] = i;
const said = [];
let calls = 0; const first = process.env;
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } if (t === 1) Object.defineProperty(process, K[0], { configurable: true, get() { calls++; return calls % 5 ? first : { LOG_LEVEL: "got" }; } }); return s + calls; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
