// Each file stores a name on `exports`, puts another value into `module.exports`, and stores a second name on `exports`: that name lands on the first object, which nobody gets.
// The store is written through type syntax, as a part of a pattern, or as a rest.
for (const [name, got] of [
  ["as.cts", require("./as.cts")],
  ["non-null.cts", require("./non-null.cts")],
  ["angle-brackets.cts", require("./angle-brackets.cts")],
  ["satisfies.cts", require("./satisfies.cts")],
  ["two-assertions.cts", require("./two-assertions.cts")],
  ["key-in-brackets.cts", require("./key-in-brackets.cts")],
  ["logical-assignment.cts", require("./logical-assignment.cts")],
  ["element-of-a-pattern.cts", require("./element-of-a-pattern.cts")],
  ["element-with-a-default.cts", require("./element-with-a-default.cts")],
  ["property-of-a-pattern.cts", require("./property-of-a-pattern.cts")],
  ["head-of-a-loop.cts", require("./head-of-a-loop.cts")],
  ["rest-of-a-list.cjs", require("./rest-of-a-list.cjs")],
  ["rest-of-an-object.cjs", require("./rest-of-an-object.cjs")],
  ["rest-under-an-assertion.cts", require("./rest-under-an-assertion.cts")],
  ["deleted.cts", require("./deleted.cts")],
])
  console.log(name, typeof got, got === undefined ? "-" : Object.keys(got).join());
