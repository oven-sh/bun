const values = [0, 1, -0, NaN, "", "a", "0", null, undefined, true, false, 0n, 7n, {}, [], Symbol("s"), () => 0, new String(""), new Number(0), 1e-320, Infinity];
const pick = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]");
let flag; const acts = [() => 0, () => { flag = 0; return 1; }, () => { flag = "on"; return 2; }, () => { flag = null; return 3; }];
const order = JSON.parse("[0,0,0,0,1,0,0,0,2,0,0,0,3,0,0,2,0,0,1,0]");
function f(x, t) { flag = x; let s = 0; for (let i = 0; i < 20; i++) { if (flag) s += 2; else s += 1; if (t % 2) s += acts[order[i]](); } return s; }
const said = []; const rounds = Number(process.argv[2] ?? 42);
for (let t = 0; t < rounds; t++) said.push(f(values[pick[t % pick.length]], t));
console.log(said.join(" "));
