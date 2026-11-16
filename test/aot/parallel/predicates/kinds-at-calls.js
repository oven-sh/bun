// lodash's isSymbol: the result is known for every primitive, so a call is made for objects alone.
// STATISTIC: PredicatesTestedAtCalls >= 2
let tagged = 0;
function getTag(value) {
  tagged++;
  return Object.prototype.toString.call(value);
}
function isObjectLike(value) {
  return value != null && typeof value == "object";
}
function isSymbol(value) {
  return typeof value == "symbol" || (isObjectLike(value) && getTag(value) == "[object Symbol]");
}
function isText(value) {
  return typeof value == "string" || (!!value && isObjectLike(value) && getTag(value) == "[object String]");
}
function isItself(value) {
  return value === value && !isSymbol(value);
}
function describe(value, other) {
  const symbol = isSymbol(value), text = isText(value), otherSymbol = isSymbol(other);
  if (!symbol && !otherSymbol && text) return "text" + isText(other);
  return symbol + "," + text + "," + otherSymbol + "," + isItself(value) + isItself();
}
class Fake {
  get [Symbol.toStringTag]() {
    return "Symbol";
  }
}
const loud = new Proxy({}, { get: (target, key) => (key === Symbol.toStringTag ? "String" : target[key]) });
const values = [0, -0, 1.5, NaN, "", "a", "b" + String(1), true, false, null, undefined, 1n, Symbol("s"), Symbol.iterator, {}, [], () => 1, class {}, new Fake(), loud, Object(Symbol("o")), Object("o"), new Date(0), Object.create(null)];
const lines = [];
for (let k = 0; k < values.length; k++) lines.push(describe(values[k], values[(k * 5 + 1) % values.length]));
console.log(lines.join("\n"));
console.log(tagged);
let count = 0;
for (let k = 0; k < 3000; k++) if (describe(values[k % values.length], k).startsWith("text")) count++;
console.log(count, tagged);
