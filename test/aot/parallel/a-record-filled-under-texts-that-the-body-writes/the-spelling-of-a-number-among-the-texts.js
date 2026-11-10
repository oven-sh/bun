// STATISTIC: StoresHeardUnderTextsThatBodyWrites = 0
function add(a, b) { return a + b; }
function scale(a, s) { return a * s; }
function other(a) { return "other" + a; }
const N = { zero: 0 };
for (const [k, v] of [["add", add], ["scale", scale], ["0", other]]) N[k] = v;
console.log(N[0](2), N["0"](3));
let sum = 0;
for (let i = 0; i < 50; i++) sum += N.add(i, 1) + N.scale(i, 2);
console.log(sum, N.zero, Object.keys(N).join());
