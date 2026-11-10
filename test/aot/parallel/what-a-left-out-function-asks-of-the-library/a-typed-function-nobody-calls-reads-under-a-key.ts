// The same in TypeScript.
// STATISTIC: FunctionsLowered <= 60
const marked = new WeakSet<object>([Object.prototype, Error.prototype]);
console.log(String(marked.has(Object.prototype)));
function pick<Held extends object>(from: Held, key: keyof Held): Held[keyof Held] {
  return from[key];
}
