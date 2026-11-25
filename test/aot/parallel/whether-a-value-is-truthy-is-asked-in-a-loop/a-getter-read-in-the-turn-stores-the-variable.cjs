const values = [0, 1, -0, NaN, "", "a", "0", null, undefined, true, false, 0n, 7n, {}, [], Symbol("s"), () => 0, new String(""), new Number(0), 1e-320, Infinity];
const pick = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]");
function f(x, t) { let s = 0; const holder = { get step() { if (s % 5 === 0) x = x ? 0 : 1; return 1; } }; for (let i = 0; i < 20; i++) { if (x) s += 2; else s += 1; s += holder.step; } return s; }
const said = []; const rounds = Number(process.argv[2] ?? 42);
for (let t = 0; t < rounds; t++) said.push(f(values[pick[t % pick.length]], t));
console.log(said.join(" "));
