const values = [0, 1, -0, NaN, "", "a", "0", null, undefined, true, false, 0n, 7n, {}, [], Symbol("s"), () => 0, new String(""), new Number(0), 1e-320, Infinity];
const pick = JSON.parse("[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20]");
function f(x, t) { let s = 0; for (let i = 0; i < 20; i++) { if (i % 3 === t % 3) { if (x) s += 2; else s += 1; } else s += 4; } return s; }
const said = []; const rounds = Number(process.argv[2] ?? 42);
for (let t = 0; t < rounds; t++) said.push(f(values[pick[t % pick.length]], t));
console.log(said.join(" "));
