const D = JSON.parse("[" + Array.from({ length: 64 }, (_, i) => i * 3).join() + "]"), T = D.map(x => "k" + x), id = [x => x, 1][JSON.parse("0")];
const m = new Map(); for (let i = 0; i < 64; i++) m.set(T[i], D[i]);
const s = new Set(); for (const x of D) s.add(x);
const C = new Map([["k0", 1], ["k3", 2], ["k6", 3], ["k9", 4], ["k12", 5], ["k15", 6], ["k18", 7], ["k21", 8]]);
function f(t) { let r = t & 1; for (let i = 0; i < 64; i++) { r += C.get(T[i & 7]); } return r; }
const n = 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(Math.floor(sum));
