const X = JSON.parse(`["never", "ever", "nowhere", "nobody"]`);
const C = new Map([["alpha", 1], ["bravo", 2], ["delta", 3], ["gamma", 4], ["hotel", 5], ["india", 6], ["kilos", 7], ["lemon", 8]]);
function f(t) { let r = t & 1; for (let i = 0; i < 64; i++) { if (C.get(X[i & 3]) === undefined) r++; } return r; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
