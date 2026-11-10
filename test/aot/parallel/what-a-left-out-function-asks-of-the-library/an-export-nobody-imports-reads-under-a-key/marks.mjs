const marked = new WeakSet([Object.prototype, Error.prototype]);
export function isMarked(value) {
  return marked.has(value);
}
export function pick(from, key) {
  return from[key];
}
