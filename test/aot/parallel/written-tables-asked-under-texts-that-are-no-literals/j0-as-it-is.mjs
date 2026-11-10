const X = JSON.parse(`["idle", "open", "busy", "closed"]`);
const C = new Map([["idle", 1], ["open", 2], ["busy", 3], ["closed", 4]]);
function f(t) { let r = t & 1; for (let i = 0; i < 64; i++) { r += C.get(X[i & 3]); } return r; }
const n = Number(process.argv[2] ?? "50"); let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
