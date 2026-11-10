// The same for an arrow function.
// STATISTIC: FunctionsLowered <= 60
const marked = new WeakSet([Object.prototype, Error.prototype]);
console.log(String(marked.has(Error.prototype)));
const pickLater = (from, key) => from[key];
