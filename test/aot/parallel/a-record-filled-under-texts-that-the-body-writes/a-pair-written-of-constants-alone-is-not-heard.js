// STATISTIC: StoresResolvedToLiteralKeys = 0
const N = { zero: 0 };
for (const [k, v] of [["length", 3], ["then", undefined], ["name", "n"]]) N[k] = v;
console.log(N.length, N.then, N.name, Object.keys(N).join());
