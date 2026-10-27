// Each of these CommonJS files holds a direct eval or a `with` statement, so its text looks names up while it runs. Each prints every frame of the stacks that it reads, whole, under four limits and below a function.
globalThis.framesOf = function framesOf(stack) {
  return String(stack)
    .split("\n")
    .filter(line => /^\s*at /.test(line))
    .map(line =>
      line
        .trim()
        .slice(3)
        .replace(/[^ ()]*[\\/]([\w.-]+:\d+:\d+)/, "$1"),
    )
    .join(" < ");
};
globalThis.show = function show(label) {
  console.log(label, "|", framesOf(new Error().stack));
  for (const limit of [1, 2, 3, 4]) {
    Error.stackTraceLimit = limit;
    console.log(label, limit, "|", framesOf(new Error().stack));
  }
  Error.stackTraceLimit = 10;
  const target = {};
  Error.captureStackTrace(target, show);
  console.log(label, "below show |", framesOf(target.stack));
};
show("the entry point");
require("./runs-a-direct-eval.cjs");
require("./runs-a-direct-eval-in-strict-code.cjs");
require("./holds-a-direct-eval-in-an-arrow-function.cjs");
require("./holds-a-direct-eval-that-never-runs.cjs");
require("./reads-a-stack-in-the-text.cjs");
require("./holds-a-with-statement.cjs");
require("./does-none-of-these.cjs");
