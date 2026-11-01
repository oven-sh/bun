// The entry of a Worker is a CommonJS file whose last statement is process.reallyExit(). The parent prints the exit code.
const { isMainThread, Worker } = require("node:worker_threads");

if (isMainThread) {
  new Worker(__filename).on("exit", code => console.log("exit code:", code));
} else {
  process.reallyExit(3);
}
