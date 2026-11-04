// The text of a CommonJS file is the body of a function whose parameters are `exports`, `require`, `module`, `__filename` and `__dirname`.
// A function that is declared in a block under the name of a parameter stays in its block: outside of it the name goes on meaning the parameter.
for (const [name, got] of [
  ["exports-in-a-block.cjs", require("./exports-in-a-block.cjs")],
  ["module-in-a-block.cjs", require("./module-in-a-block.cjs")],
  ["require-in-a-block.cjs", require("./require-in-a-block.cjs")],
  ["paths-in-a-block.cjs", require("./paths-in-a-block.cjs")],
  ["behind-if.cjs", require("./behind-if.cjs")],
  ["in-a-case.cjs", require("./in-a-case.cjs")],
  ["in-a-loop.cjs", require("./in-a-loop.cjs")],
  ["in-a-catch.cjs", require("./in-a-catch.cjs")],
  ["named-inside-the-block.cjs", require("./named-inside-the-block.cjs")],
  ["beside-a-var.cjs", require("./beside-a-var.cjs")],
  ["strict.cjs", require("./strict.cjs")],
])
  console.log(name, got.seen.join(" | "));
