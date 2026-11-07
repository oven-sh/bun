// Two records of one literal, each with one more member under a key that is made at run time. One of them also gets "constructor": a value or a getter, enumerable or not. node:util's isDeepStrictEqual and node:assert's deepStrictEqual hold the constructor that the first of the two inherits against what the second answers under that name.
const { isDeepStrictEqual } = require("node:util");
const assert = require("node:assert");
const pairs = require("./pairs.cjs");

for (const [label, make] of pairs) {
  const [first, second] = make();
  const equal = isDeepStrictEqual(first, second);
  let asserted = "passes";
  try {
    assert.deepStrictEqual(first, second);
  } catch (error) {
    asserted = error.code;
  }
  console.log(label + ":", equal, asserted);
}
