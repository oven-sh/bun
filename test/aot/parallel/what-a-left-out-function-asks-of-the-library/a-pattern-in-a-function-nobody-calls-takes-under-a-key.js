// A pattern reads under its key as a member expression does.
// STATISTIC: FunctionsLowered <= 60
const marked = new WeakSet([Object.prototype, Error.prototype]);
console.log(String(marked.has(Object.prototype)));
function take(from, key) {
  const { [key]: found } = from;
  return found;
}
