// STATISTIC: StoresResolvedToLiteralKeys >= 1
function made() { return "made"; }
function text() { return "text"; }
function worth() { return 7; }
const N = { zero: 0 };
for (const [k, v] of [["constructor", made], ["toString", text], ["valueOf", worth], ["length", worth], ["hasOwnProperty", made]]) N[k] = v;
console.log(N.constructor(), `${N}`, N + 1, N.length(), N.hasOwnProperty("zero"), Object.keys(N).join());
