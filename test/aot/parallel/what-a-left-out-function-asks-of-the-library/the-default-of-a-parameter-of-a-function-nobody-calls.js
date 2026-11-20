// The default of a parameter runs only where the function is called.
// STATISTIC: FunctionsLowered <= 60
const marked = new WeakSet([Object.prototype, Error.prototype]);
console.log(String(marked.has(Object.prototype)));
function pick(from, key, found = from[key]) {
  return found;
}
