function Other() {}
let made = 0;
// Two records of one literal with one more member under a key that no record has had: under --aot the two are then of one Structure, whatever `owns` gets beside it.
function pair(name, descriptor) {
  const make = () => ({ a: 1 });
  const inherits = make(), owns = make();
  const late = "late" + made++;
  inherits[late] = 1;
  owns[late] = 1;
  return [inherits, Object.defineProperty(owns, name, descriptor)];
}
const value = (held, enumerable) => ({ value: held, writable: true, enumerable, configurable: true });
const getter = enumerable => ({ get() { return Other; }, enumerable, configurable: true });
// Each row: what it is, and what makes the first and the second of the two records that are compared.
module.exports = [
  ["a value that is not enumerable, on the second", () => pair("constructor", value(Other, false))],
  ["a getter that is not enumerable, on the second", () => pair("constructor", getter(false))],
  ["a value that is enumerable, on the second", () => pair("constructor", value(Other, true))],
  ["a value that is enumerable, on the first", () => pair("constructor", value(Other, true)).reverse()],
  ["a getter that is enumerable, on the second", () => pair("constructor", getter(true))],
  ["a getter that is enumerable, on the first", () => pair("constructor", getter(true)).reverse()],
  ["Object as a value that is not enumerable, on the second", () => pair("constructor", value(Object, false))],
  ["Object as a value that is not enumerable, on the first", () => pair("constructor", value(Object, false)).reverse()],
  ["a value that is not enumerable under another name, on the second", () => pair("other", value(Other, false))],
];
