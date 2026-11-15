// `outer` names `inner`, and nobody names `outer`.
// STATISTIC: FunctionsLowered <= 60
const marked = new WeakSet([Object.prototype, Error.prototype]);
console.log(String(marked.has(Object.prototype)));
function inner(from, key) {
  return from[key];
}
function outer(from) {
  return inner(from, String(from));
}
