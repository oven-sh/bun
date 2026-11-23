// The functions of this file are there before it has run, what they work with is not: one is a variable that holds nothing yet, the other a variable that may not be read yet.
import "./loads.mjs";
export function __exportStar(from, to) {
  for (const [name, reader] of readersOf(from)) {
    if (name === "default" || Object.hasOwn(to, name)) continue;
    Object.defineProperty(to, name, reader);
  }
}
export function __importStar(from) {
  if (marked.has(from)) return from;
  const whole = Object.create(null);
  for (const [name, reader] of readersOf(from)) Object.defineProperty(whole, name, reader);
  whole.default ??= from;
  marked.add(whole);
  return whole;
}
var readersOf = from => Object.keys(from).map(name => [name, { get: () => from[name], enumerable: true, configurable: true }]);
const marked = new WeakSet();
