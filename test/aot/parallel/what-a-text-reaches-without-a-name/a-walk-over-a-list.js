// A loop over values, a pattern of a list and a spread ask for the helpers of the walk and for `next`, `return`, `throw` of what can be walked, and for nothing of the host.
// STATISTIC: FunctionsLowered <= 40
// STATISTIC: SourceFilesRuntime <= 12
let sum = 0;
for (const value of [1, 2, 3]) sum += value;
const [first, ...others] = [4, 5, 6];
console.log(sum, first, others.length, Math.max(...[7, 8]));
