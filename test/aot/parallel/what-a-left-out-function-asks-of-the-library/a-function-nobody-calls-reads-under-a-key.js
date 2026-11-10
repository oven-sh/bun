// Nobody calls `pick`: it is left out of the executable, so the key that it reads under finds nothing of the library.
// STATISTIC: FunctionsLowered <= 60
const marked = new WeakSet([Object.prototype, Error.prototype]);
console.log(String(marked.has(Object.prototype)));
function pick(from, key) {
  const found = from[key];
  return found;
}
