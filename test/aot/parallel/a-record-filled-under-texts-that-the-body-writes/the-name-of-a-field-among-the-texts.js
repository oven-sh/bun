// STATISTIC: StoresResolvedToLiteralKeys >= 1
function add(a, b) { return a + b; }
function scale(a, s) { return a * s; }
function other(a) { return "other" + a; }
const N = { zero: 0 };
for (const [k, v] of [["add", add], ["scale", scale], ["zero", other]]) N[k] = v;
console.log(typeof N.zero, N.zero(4));
let sum = 0;
for (let i = 0; i < 50; i++) sum += N.add(i, 1) + N.scale(i, 2);
console.log(sum, Object.keys(N).join());
