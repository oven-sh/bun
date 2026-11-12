// The same for a function that a constant holds, and for the function inside it.
// STATISTIC: FunctionsLowered <= 60
const marked = new WeakSet([Object.prototype, Error.prototype]);
console.log(String(marked.has(Error.prototype)));
const pickLater = function (from) {
  return key => from[key];
};
