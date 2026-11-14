import { Worker, SHARE_ENV } from "node:worker_threads";
process.env.K80A = "old"; let w = null; const first = process.env;
function f(n) { let s = ""; for (let i = 0; i < n; i++) { if (i === 2) w = new Worker("", { eval: true, env: SHARE_ENV }); s += process.env.K80A + (process.env === first) + ";"; } return s; }
console.log(f(+process.argv[2] || 5)); if (w) await w.terminate();
