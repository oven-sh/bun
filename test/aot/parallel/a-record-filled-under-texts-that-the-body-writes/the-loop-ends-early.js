// STATISTIC: StoresHeardUnderTextsThatBodyWrites >= 1
function add(a, b) { return a + b; }
function scale(a, s) { return a * s; }
function other(a) { return "other" + a; }
const N = { zero: 0 };
for (const [k, v] of [["add", add], ["scale", scale]]) { N[k] = v; if (k === "add") break; }
console.log(typeof N.add, typeof N.scale, N.add(1, 2), Object.keys(N).join());
