// Each file stores into a field of its module object and reads the field again. The store is written through type syntax, as a part of a pattern, or as a rest.
for (const [name, got] of [
  ["as.cts", require("./as.cts")],
  ["non-null.cts", require("./non-null.cts")],
  ["angle-brackets.cts", require("./angle-brackets.cts")],
  ["satisfies.cts", require("./satisfies.cts")],
  ["compound.cts", require("./compound.cts")],
  ["element-of-a-pattern.cts", require("./element-of-a-pattern.cts")],
  ["head-of-a-loop.cts", require("./head-of-a-loop.cts")],
  ["rest-of-a-list.cjs", require("./rest-of-a-list.cjs")],
  ["rest-of-an-object.cjs", require("./rest-of-an-object.cjs")],
  ["filename.cts", require("./filename.cts")],
  ["path.cts", require("./path.cts")],
  ["loaded.cts", require("./loaded.cts")],
  ["paths.cts", require("./paths.cts")],
])
  console.log(name, got.read);
