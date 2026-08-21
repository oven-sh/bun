// `bun --print` / `-p`: print the eval entry's completion value on beforeExit/exit.
// Matches https://github.com/nodejs/node/blob/main/lib/internal/process/execution.js (runScriptInContext).
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
    // Top-level-await eval entry (Bun extension; Node rejects --print with ESM):
    // print the async-capability promise's resolution, or the pending promise if
    // it never settles. On rejection the loader already reports the error.
    (result as Promise<unknown>).$then(
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
