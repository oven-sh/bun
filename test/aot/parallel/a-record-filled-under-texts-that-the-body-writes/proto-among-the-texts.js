// STATISTIC: StoresResolvedToLiteralKeys = 0
function add(a, b) { return a + b; }
function scale(a, s) { return a * s; }
function other(a) { return "other" + a; }
const above = { inherited() { return "from above"; }, add, scale };
const N = { zero: 0 };
for (const [k, v] of [["extra", other], ["__proto__", above]]) N[k] = v;
console.log(N.inherited(), Object.getPrototypeOf(N) === above, N.extra(1));
let sum = 0;
for (let i = 0; i < 50; i++) sum += N.add(i, 1) + N.scale(i, 2);
console.log(sum, N.zero, Object.keys(N).join());
