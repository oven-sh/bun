// Each method comes for its name: the others of Array.prototype stay out, and so does the host.
// STATISTIC: FunctionsLowered <= 400
// STATISTIC: SourceFilesRuntime <= 50
const list = [3, 1, 2];
console.log(list.map(value => value * 2).filter(value => value > 2).join(), list.reduce((sum, value) => sum + value, 0), list.find(value => value > 1), list.some(value => value > 2), Array.isArray(list), Object.keys(list).length);
