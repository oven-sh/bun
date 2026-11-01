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
/* Output:
an array, lengthOf: 4
an array, collectByIndex: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
an array, collectByIteration: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
an array, concatenateByIndex: "0abcb"
an array, last: "b"
an array, copied: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
an array, firstTwoAndRest: Array [0: "a", 1: "b", 2: Array [0: "c", 1: "b", length: 2], length: 3]
an array, sliced: Array [0: "b", 1: "c", length: 2]
an array, slicedFromTheEnd: Array [0: "c", 1: "b", length: 2]
an array, concatenated: Array [0: "a", 1: "b", 2: "c", 3: "b", 4: "a", 5: "b", 6: "c", 7: "b", length: 8]
an array, concatenatedWithAnArray: Array [0: "a", 1: "b", 2: "c", 3: "b", 4: 1, 5: 2, length: 6]
an array, placeOf: Array [0: 1, 1: 3, 2: true, length: 3]
an array, placeOfNothing: Array [0: -1, 1: -1, 2: false, length: 3]
an array, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
an array, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
an array, storeFirst: "X"
an array, storeFirstStrictly: "X"
an array, storePastTheEnd: 5
an array, storeLength: 1
an array, storeLengthStrictly: 1
an array, hasFirst: true
an array, removeFirst: true
an array, from: Array [0: "aa", 1: "bb", 2: "cc", 3: "bb", length: 4]
an array, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
an array, entriesOf: 4
an array, isIt: Array [0: true, 1: "object", 2: true, 3: false, length: 4]
a string, lengthOf: 4
a string, collectByIndex: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a string, collectByIteration: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a string, concatenateByIndex: "0abcb"
a string, last: "b"
a string, copied: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a string, firstTwoAndRest: Array [0: "a", 1: "b", 2: Array [0: "c", 1: "b", length: 2], length: 3]
a string, sliced: "bc"
a string, slicedFromTheEnd: "cb"
a string, concatenated: "abcbabcb"
a string, concatenatedWithAnArray: "abcb1,2"
a string, placeOf: Array [0: 1, 1: 3, 2: true, length: 3]
a string, placeOfNothing: Array [0: 0, 1: 4, 2: true, length: 3]
a string, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
a string, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
a string, storeFirst: "a"
a string, storeFirstStrictly: threw TypeError
a string, storePastTheEnd: 4
a string, storeLength: 4
a string, storeLengthStrictly: threw TypeError
a string, hasFirst: threw TypeError
a string, removeFirst: false
a string, from: Array [0: "aa", 1: "bb", 2: "cc", 3: "bb", length: 4]
a string, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
a string, entriesOf: 4
a string, isIt: Array [0: false, 1: "string", 2: false, 3: false, length: 4]
an empty string, lengthOf: 0
an empty string, collectByIndex: Array [length: 0]
an empty string, collectByIteration: Array [length: 0]
an empty string, concatenateByIndex: 0
an empty string, last: undefined
an empty string, copied: Array [length: 0]
an empty string, firstTwoAndRest: Array [0: undefined, 1: undefined, 2: Array [length: 0], length: 3]
an empty string, sliced: ""
an empty string, slicedFromTheEnd: ""
an empty string, concatenated: ""
an empty string, concatenatedWithAnArray: "1,2"
an empty string, placeOf: Array [0: -1, 1: -1, 2: false, length: 3]
an empty string, placeOfNothing: Array [0: 0, 1: 0, 2: true, length: 3]
an empty string, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
an empty string, ends: Array [0: undefined, 1: undefined, 2: undefined, length: 3]
an empty string, storeFirst: undefined
an empty string, storeFirstStrictly: threw TypeError
an empty string, storePastTheEnd: 0
an empty string, storeLength: 0
an empty string, storeLengthStrictly: threw TypeError
an empty string, hasFirst: threw TypeError
an empty string, removeFirst: true
an empty string, from: Array [length: 0]
an empty string, keys: Array [length: 0]
an empty string, entriesOf: 0
an empty string, isIt: Array [0: false, 1: "string", 2: false, 3: false, length: 4]
a string with a pair of surrogates, lengthOf: 4
a string with a pair of surrogates, collectByIndex: Array [0: "a", 1: "\ud83d", 2: "\ude00", 3: "b", length: 4]
a string with a pair of surrogates, collectByIteration: Array [0: "a", 1: "😀", 2: "b", length: 3]
a string with a pair of surrogates, concatenateByIndex: "0a😀b"
a string with a pair of surrogates, last: "b"
a string with a pair of surrogates, copied: Array [0: "a", 1: "😀", 2: "b", length: 3]
a string with a pair of surrogates, firstTwoAndRest: Array [0: "a", 1: "😀", 2: Array [0: "b", length: 1], length: 3]
a string with a pair of surrogates, sliced: "😀"
a string with a pair of surrogates, slicedFromTheEnd: "\ude00b"
a string with a pair of surrogates, concatenated: "a😀ba😀b"
a string with a pair of surrogates, concatenatedWithAnArray: "a😀b1,2"
a string with a pair of surrogates, placeOf: Array [0: 3, 1: 3, 2: true, length: 3]
a string with a pair of surrogates, placeOfNothing: Array [0: 0, 1: 4, 2: true, length: 3]
a string with a pair of surrogates, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
a string with a pair of surrogates, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
a string with a pair of surrogates, storeFirst: "a"
a string with a pair of surrogates, storeFirstStrictly: threw TypeError
a string with a pair of surrogates, storePastTheEnd: 4
a string with a pair of surrogates, storeLength: 4
a string with a pair of surrogates, storeLengthStrictly: threw TypeError
a string with a pair of surrogates, hasFirst: threw TypeError
a string with a pair of surrogates, removeFirst: false
a string with a pair of surrogates, from: Array [0: "aa", 1: "😀😀", 2: "bb", length: 3]
a string with a pair of surrogates, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
a string with a pair of surrogates, entriesOf: 4
a string with a pair of surrogates, isIt: Array [0: false, 1: "string", 2: false, 3: false, length: 4]
a string with a lone surrogate, lengthOf: 3
a string with a lone surrogate, collectByIndex: Array [0: "a", 1: "\ud83d", 2: "b", length: 3]
a string with a lone surrogate, collectByIteration: Array [0: "a", 1: "\ud83d", 2: "b", length: 3]
a string with a lone surrogate, concatenateByIndex: "0a\ud83db"
a string with a lone surrogate, last: "b"
a string with a lone surrogate, copied: Array [0: "a", 1: "\ud83d", 2: "b", length: 3]
a string with a lone surrogate, firstTwoAndRest: Array [0: "a", 1: "\ud83d", 2: Array [0: "b", length: 1], length: 3]
a string with a lone surrogate, sliced: "\ud83db"
a string with a lone surrogate, slicedFromTheEnd: "\ud83db"
a string with a lone surrogate, concatenated: "a\ud83dba\ud83db"
a string with a lone surrogate, concatenatedWithAnArray: "a\ud83db1,2"
a string with a lone surrogate, placeOf: Array [0: 2, 1: 2, 2: true, length: 3]
a string with a lone surrogate, placeOfNothing: Array [0: 0, 1: 3, 2: true, length: 3]
a string with a lone surrogate, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
a string with a lone surrogate, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
a string with a lone surrogate, storeFirst: "a"
a string with a lone surrogate, storeFirstStrictly: threw TypeError
a string with a lone surrogate, storePastTheEnd: 3
a string with a lone surrogate, storeLength: 3
a string with a lone surrogate, storeLengthStrictly: threw TypeError
a string with a lone surrogate, hasFirst: threw TypeError
a string with a lone surrogate, removeFirst: false
a string with a lone surrogate, from: Array [0: "aa", 1: "\ud83d\ud83d", 2: "bb", length: 3]
a string with a lone surrogate, keys: Array [0: "0", 1: "1", 2: "2", length: 3]
a string with a lone surrogate, entriesOf: 3
a string with a lone surrogate, isIt: Array [0: false, 1: "string", 2: false, 3: false, length: 4]
a string of digits, lengthOf: 4
a string of digits, collectByIndex: Array [0: "1", 1: "2", 2: "1", 3: "3", length: 4]
a string of digits, collectByIteration: Array [0: "1", 1: "2", 2: "1", 3: "3", length: 4]
a string of digits, concatenateByIndex: "01213"
a string of digits, last: "3"
a string of digits, copied: Array [0: "1", 1: "2", 2: "1", 3: "3", length: 4]
a string of digits, firstTwoAndRest: Array [0: "1", 1: "2", 2: Array [0: "1", 1: "3", length: 2], length: 3]
a string of digits, sliced: "21"
a string of digits, slicedFromTheEnd: "13"
a string of digits, concatenated: "12131213"
a string of digits, concatenatedWithAnArray: "12131,2"
a string of digits, placeOf: Array [0: -1, 1: -1, 2: false, length: 3]
a string of digits, placeOfNothing: Array [0: 0, 1: 4, 2: true, length: 3]
a string of digits, placeOfANumber: Array [0: 0, 1: 2, 2: true, length: 3]
a string of digits, ends: Array [0: "1", 1: "3", 2: undefined, length: 3]
a string of digits, storeFirst: "1"
a string of digits, storeFirstStrictly: threw TypeError
a string of digits, storePastTheEnd: 4
a string of digits, storeLength: 4
a string of digits, storeLengthStrictly: threw TypeError
a string of digits, hasFirst: threw TypeError
a string of digits, removeFirst: false
a string of digits, from: Array [0: "11", 1: "22", 2: "11", 3: "33", length: 4]
a string of digits, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
a string of digits, entriesOf: 4
a string of digits, isIt: Array [0: false, 1: "string", 2: false, 3: false, length: 4]
a concatenated string, lengthOf: 4
a concatenated string, collectByIndex: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a concatenated string, collectByIteration: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a concatenated string, concatenateByIndex: "0abcb"
a concatenated string, last: "b"
a concatenated string, copied: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a concatenated string, firstTwoAndRest: Array [0: "a", 1: "b", 2: Array [0: "c", 1: "b", length: 2], length: 3]
a concatenated string, sliced: "bc"
a concatenated string, slicedFromTheEnd: "cb"
a concatenated string, concatenated: "abcbabcb"
a concatenated string, concatenatedWithAnArray: "abcb1,2"
a concatenated string, placeOf: Array [0: 1, 1: 3, 2: true, length: 3]
a concatenated string, placeOfNothing: Array [0: 0, 1: 4, 2: true, length: 3]
a concatenated string, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
a concatenated string, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
a concatenated string, storeFirst: "a"
a concatenated string, storeFirstStrictly: threw TypeError
a concatenated string, storePastTheEnd: 4
a concatenated string, storeLength: 4
a concatenated string, storeLengthStrictly: threw TypeError
a concatenated string, hasFirst: threw TypeError
a concatenated string, removeFirst: false
a concatenated string, from: Array [0: "aa", 1: "bb", 2: "cc", 3: "bb", length: 4]
a concatenated string, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
a concatenated string, entriesOf: 4
a concatenated string, isIt: Array [0: false, 1: "string", 2: false, 3: false, length: 4]
a String object, lengthOf: 4
a String object, collectByIndex: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a String object, collectByIteration: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a String object, concatenateByIndex: "0abcb"
a String object, last: "b"
a String object, copied: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a String object, firstTwoAndRest: Array [0: "a", 1: "b", 2: Array [0: "c", 1: "b", length: 2], length: 3]
a String object, sliced: "bc"
a String object, slicedFromTheEnd: "cb"
a String object, concatenated: "abcbabcb"
a String object, concatenatedWithAnArray: "abcb1,2"
a String object, placeOf: Array [0: 1, 1: 3, 2: true, length: 3]
a String object, placeOfNothing: Array [0: 0, 1: 4, 2: true, length: 3]
a String object, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
a String object, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
a String object, storeFirst: "a"
a String object, storeFirstStrictly: threw TypeError
a String object, storePastTheEnd: 4
a String object, storeLength: 4
a String object, storeLengthStrictly: threw TypeError
a String object, hasFirst: true
a String object, removeFirst: false
a String object, from: Array [0: "aa", 1: "bb", 2: "cc", 3: "bb", length: 4]
a String object, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
a String object, entriesOf: 4
a String object, isIt: Array [0: false, 1: "object", 2: false, 3: true, length: 4]
a String object with more properties, lengthOf: 2
a String object with more properties, collectByIndex: Array [0: "a", 1: "b", length: 2]
a String object with more properties, collectByIteration: Array [0: "a", 1: "b", length: 2]
a String object with more properties, concatenateByIndex: "0ab"
a String object with more properties, last: "b"
a String object with more properties, copied: Array [0: "a", 1: "b", length: 2]
a String object with more properties, firstTwoAndRest: Array [0: "a", 1: "b", 2: Array [length: 0], length: 3]
a String object with more properties, sliced: "b"
a String object with more properties, slicedFromTheEnd: "ab"
a String object with more properties, concatenated: "abab"
a String object with more properties, concatenatedWithAnArray: "ab1,2"
a String object with more properties, placeOf: Array [0: 1, 1: 1, 2: true, length: 3]
a String object with more properties, placeOfNothing: Array [0: 0, 1: 2, 2: true, length: 3]
a String object with more properties, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
a String object with more properties, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
a String object with more properties, storeFirst: "a"
a String object with more properties, storeFirstStrictly: threw TypeError
a String object with more properties, storePastTheEnd: 2
a String object with more properties, storeLength: 2
a String object with more properties, storeLengthStrictly: threw TypeError
a String object with more properties, hasFirst: true
a String object with more properties, removeFirst: false
a String object with more properties, from: Array [0: "aa", 1: "bb", length: 2]
a String object with more properties, keys: Array [0: "0", 1: "1", 2: "2", 3: "5", 4: "name", length: 5]
a String object with more properties, entriesOf: 5
a String object with more properties, isIt: Array [0: false, 1: "object", 2: false, 3: true, length: 4]
a subclass of String, lengthOf: 4
a subclass of String, collectByIndex: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a subclass of String, collectByIteration: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a subclass of String, concatenateByIndex: "0abcb"
a subclass of String, last: "b"
a subclass of String, copied: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
a subclass of String, firstTwoAndRest: Array [0: "a", 1: "b", 2: Array [0: "c", 1: "b", length: 2], length: 3]
a subclass of String, sliced: "bc"
a subclass of String, slicedFromTheEnd: "cb"
a subclass of String, concatenated: "abcbabcb"
a subclass of String, concatenatedWithAnArray: "abcb1,2"
a subclass of String, placeOf: Array [0: 1, 1: 3, 2: true, length: 3]
a subclass of String, placeOfNothing: Array [0: 0, 1: 4, 2: true, length: 3]
a subclass of String, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
a subclass of String, ends: Array [0: "overridden", 1: "overridden", 2: "overridden", length: 3]
a subclass of String, storeFirst: "a"
a subclass of String, storeFirstStrictly: threw TypeError
a subclass of String, storePastTheEnd: 4
a subclass of String, storeLength: 4
a subclass of String, storeLengthStrictly: threw TypeError
a subclass of String, hasFirst: true
a subclass of String, removeFirst: false
a subclass of String, from: Array [0: "aa", 1: "bb", 2: "cc", 3: "bb", length: 4]
a subclass of String, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
a subclass of String, entriesOf: 4
a subclass of String, isIt: Array [0: false, 1: "object", 2: false, 3: true, length: 4]
an array again, lengthOf: 4
an array again, collectByIndex: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
an array again, collectByIteration: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
an array again, concatenateByIndex: "0abcb"
an array again, last: "b"
an array again, copied: Array [0: "a", 1: "b", 2: "c", 3: "b", length: 4]
an array again, firstTwoAndRest: Array [0: "a", 1: "b", 2: Array [0: "c", 1: "b", length: 2], length: 3]
an array again, sliced: Array [0: "b", 1: "c", length: 2]
an array again, slicedFromTheEnd: Array [0: "c", 1: "b", length: 2]
an array again, concatenated: Array [0: "a", 1: "b", 2: "c", 3: "b", 4: "a", 5: "b", 6: "c", 7: "b", length: 8]
an array again, concatenatedWithAnArray: Array [0: "a", 1: "b", 2: "c", 3: "b", 4: 1, 5: 2, length: 6]
an array again, placeOf: Array [0: 1, 1: 3, 2: true, length: 3]
an array again, placeOfNothing: Array [0: -1, 1: -1, 2: false, length: 3]
an array again, placeOfANumber: Array [0: -1, 1: -1, 2: false, length: 3]
an array again, ends: Array [0: "a", 1: "b", 2: undefined, length: 3]
an array again, storeFirst: "X"
an array again, storeFirstStrictly: "X"
an array again, storePastTheEnd: 5
an array again, storeLength: 1
an array again, storeLengthStrictly: 1
an array again, hasFirst: true
an array again, removeFirst: true
an array again, from: Array [0: "aa", 1: "bb", 2: "cc", 3: "bb", length: 4]
an array again, keys: Array [0: "0", 1: "1", 2: "2", 3: "3", length: 4]
an array again, entriesOf: 4
an array again, isIt: Array [0: true, 1: "object", 2: true, 3: false, length: 4]
*/
