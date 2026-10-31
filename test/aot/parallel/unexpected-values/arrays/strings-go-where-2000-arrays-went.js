function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function lengthOf(list) {
  return list.length;
}

function collectByIndex(list) {
  const seen = [];
  for (let i = 0; i < list.length; i++) seen.push(list[i]);
  return seen;
}

function collectByIteration(list) {
  const seen = [];
  for (const value of list) seen.push(value);
  return seen;
}

function concatenateByIndex(list) {
  let total = 0;
  for (let i = 0; i < list.length; i++) total += list[i];
  return total;
}

function last(list) {
  return list[list.length - 1];
}

function copied(list) {
  return [...list];
}

function firstTwoAndRest(list) {
  const [a, b, ...rest] = list;
  return [a, b, rest];
}

function sliced(list) {
  return list.slice(1, 3);
}

function slicedFromTheEnd(list) {
  return list.slice(-2);
}

function concatenated(list) {
  return list.concat(list);
}

function concatenatedWithAnArray(list) {
  return list.concat([1, 2]);
}

function placeOf(list, value) {
  return [list.indexOf(value), list.lastIndexOf(value), list.includes(value)];
}

function ends(list) {
  return [list.at(0), list.at(-1), list.at(9)];
}

function storeFirst(list) {
  list[0] = "X";
  return list[0];
}

function storeFirstStrictly(list) {
  "use strict";
  list[0] = "X";
  return list[0];
}

function storePastTheEnd(list) {
  list[list.length] = "X";
  return list.length;
}

function storeLength(list) {
  list.length = 1;
  return list.length;
}

function storeLengthStrictly(list) {
  "use strict";
  list.length = 1;
  return list.length;
}

function hasFirst(list) {
  return 0 in list;
}

function removeFirst(list) {
  return delete list[0];
}

function from(list) {
  return Array.from(list, value => value + value);
}

function keys(list) {
  return Object.keys(list);
}

function entriesOf(list) {
  return Object.entries(list).length;
}

function isIt(list) {
  return [Array.isArray(list), typeof list, list instanceof Array, list instanceof String];
}

const uses = {
  lengthOf, collectByIndex, collectByIteration, concatenateByIndex, last, copied, firstTwoAndRest, sliced, slicedFromTheEnd, concatenated,
  concatenatedWithAnArray, placeOf: list => placeOf(list, "b"), placeOfNothing: list => placeOf(list, ""), placeOfANumber: list => placeOf(list, 1), ends,
  storeFirst, storeFirstStrictly, storePastTheEnd, storeLength, storeLengthStrictly, hasFirst, removeFirst, from, keys, entriesOf, isIt,
};

const makers = {
  "an array": () => ["a", "b", "c", "b"],
  "a string": () => "abcb",
  "an empty string": () => "",
  "a string with a pair of surrogates": () => "a\u{1F600}b",
  "a string with a lone surrogate": () => "a\uD83Db",
  "a string of digits": () => "1213",
  "a concatenated string": () => ["ab", "cb"].join("") + "",
  "a String object": () => new String("abcb"),
  "a String object with more properties": () => Object.assign(new String("ab"), { 2: "own", 5: "far", name: "named" }),
  "a subclass of String": () => new (class Text extends String { get length() { return 1; } at() { return "overridden"; } })("abcb"),
};

for (const use in uses) for (let i = 0; i < 2000; i++) uses[use](["a", "b", "c", "b"]);

for (const name in makers) for (const use in uses) attempt(name + ", " + use, () => uses[use](makers[name]()));
for (const use in uses) attempt("an array again, " + use, () => uses[use](["a", "b", "c", "b"]));

module.exports = uses;
