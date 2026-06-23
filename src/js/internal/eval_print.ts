// Implements the printing half of `bun --print` / `bun -p`.
//
// Matches Node.js (lib/internal/process/execution.js, runScriptInContext): the
// completion value of the eval entry point is printed with console.log
// formatting (node:util inspect; promises are not awaited or unwrapped) on the
// first "beforeExit", or on "exit" when the process exits before the event
// loop drains, so `--print 'setTimeout(process.exit, 100); somePromise'` still
// prints the pending promise.
const { formatWithOptions } = require("node:util");

let registered = false;

function registerEvalPrint(result: unknown, awaitFirst: boolean = false) {
  // The ES module path can capture the entry-point result more than once
  // (a top-level-await module first reports its async capability promise);
  // only the first capture registers the print.
  if (registered) return;
  registered = true;

  const printResult = () => {
    const stream = process.stdout;
    const colors = typeof stream.hasColors === "function" ? stream.hasColors() : false;
    stream.write(formatWithOptions({ colors }, result) + "\n");
  };

  const onBeforeExit = () => {
    printResult();
    process.off("exit", printResult);
  };

  if (awaitFirst && $isPromise(result)) {
    // Top-level-await eval entry: the captured value is the module's async
    // capability promise, not a value the user wrote. Print its resolution
    // (Bun extension - Node rejects --print with ESM input entirely) and keep
    // printing the promise itself if it never settles. If module evaluation
    // rejects, the loader already reports the error, so skip the print.
    (result as Promise<unknown>).then(
      value => {
        result = value;
      },
      () => {
        process.off("exit", printResult);
        process.off("beforeExit", onBeforeExit);
      },
    );
  }

  process.on("exit", printResult);
  process.once("beforeExit", onBeforeExit);
}

export default registerEvalPrint;
