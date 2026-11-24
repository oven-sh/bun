const said = [];
const { Worker, SHARE_ENV } = require("node:worker_threads");
const first = process.env;
function f(t) { let s = t; for (let i = 0; i < 20; i++) { s = (s * 31 + (process.env.MADE_UP_HOME === undefined ? 1 : 2) + ((process.env.LOG_LEVEL || "info") === "info" ? 3 : 5)) % 1000003; } return s * 2 + (process.env === first ? 0 : 1); }
const rounds = Number(process.argv[2] ?? 6);
for (let t = 0; t < 3; t++) said.push(f(t));
const worker = new Worker("process.env.MADE_UP_HOME = '/worker';", { eval: true, env: SHARE_ENV });
process.env.LOG_LEVEL = "shared";
worker.on("exit", () => {
  for (let t = 3; t < rounds + 2; t++) said.push(f(t));
  console.log(said.join(" "));
});
