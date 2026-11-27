const said = [];
let calls = 0;
delete process.env.MADE_UP_HOME;
Object.setPrototypeOf(process.env, { get MADE_UP_HOME() { calls++; return calls % 3 ? "/g" : undefined; } });
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } return s + calls; }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < rounds; t++) said.push(f(t));
console.log(said.join(" "));
