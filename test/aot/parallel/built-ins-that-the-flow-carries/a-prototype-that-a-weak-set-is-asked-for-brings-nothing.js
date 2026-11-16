// STATISTIC: ImageFunctionsEmitted <= 4
const kept = new WeakSet([Object.prototype, Error.prototype]);
function walk(curr, el) { return curr[el]; }
console.log(kept.has(Object.prototype), kept.has({}), typeof walk);
