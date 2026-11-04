// A `var` is undefined until its line has run. Each file keeps its module object, `require` or `require.main` in one and asks it for members where the line has not run, and where it has.
for (const [name, got] of [
  ["branch-not-taken.cjs", require("./branch-not-taken.cjs")],
  ["branch-not-taken-other-members.cjs", require("./branch-not-taken-other-members.cjs")],
  ["read-above-the-line.cjs", require("./read-above-the-line.cjs")],
  ["function-called-above-the-line.cjs", require("./function-called-above-the-line.cjs")],
  ["without-a-question-mark.cjs", require("./without-a-question-mark.cjs")],
  ["handed-on-to-a-constant.cjs", require("./handed-on-to-a-constant.cjs")],
  ["case-not-taken.cjs", require("./case-not-taken.cjs")],
  ["behind-a-throw.cjs", require("./behind-a-throw.cjs")],
  ["behind-a-break.cjs", require("./behind-a-break.cjs")],
  ["static-field-above-the-line.cjs", require("./static-field-above-the-line.cjs")],
  ["first-turn-of-a-loop.cjs", require("./first-turn-of-a-loop.cjs")],
  ["in-a-function.cjs", require("./in-a-function.cjs")],
  ["require-in-a-var.cjs", require("./require-in-a-var.cjs")],
  ["main-module-in-a-var.cjs", require("./main-module-in-a-var.cjs")],
  ["line-has-run.cjs", require("./line-has-run.cjs")],
  ["store-through-the-var-is-read-by-the-name.cjs", require("./store-through-the-var-is-read-by-the-name.cjs")],
  ["exports-replaced-through-the-var.cjs", require("./exports-replaced-through-the-var.cjs")],
])
  console.log(name, got.seen.join(" | "));
