// Each of these CommonJS files, the entry point too, stores to one of `exports`, `require`, `module`, `__filename` and `__dirname`, declares one of them again or names `arguments`. Each prints every frame of the stacks that it reads, whole, under four limits and below a function. One file throws.
globalThis.framesOf = function framesOf(stack) {
  return String(stack)
    .split("\n")
    .filter(line => /^\s*at /.test(line))
    .map(line =>
      line
        .trim()
        .slice(3)
        .replace(/[^ ()]*[\\/]([\w.-]+:\d+:\d+)/, "$1")
        .replace(/native:\d+:\d+/, "native"),
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
exports = {};
show("the entry point");
require("./names-arguments.cjs");
require("./names-arguments-in-strict-code.cjs");
require("./declares-exports-again.cjs");
require("./declares-module-again.cjs");
require("./declares-require-again.cjs");
require("./stores-to-exports.cjs");
require("./stores-to-exports-in-strict-code.cjs");
require("./stores-to-module.cjs");
require("./stores-to-require.cjs");
require("./stores-to-filename.cjs");
require("./stores-to-dirname.cjs");
require("./does-none-of-these.cjs");
function loads() {
  return require("./required-in-a-function.cjs");
}
loads();
try {
  require("./throws.cjs");
} catch (error) {
  console.log("thrown |", framesOf(error.stack));
}
import("./imported.cjs").then(() => show("behind the import"));
