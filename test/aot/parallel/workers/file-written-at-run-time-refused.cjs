// A Worker of a file that the program writes at run time is refused, and the error names what helps: with --aot-allow-code-from-disk the Worker runs the file.
const { Worker } = require("node:worker_threads");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const folder = mkdtempSync(join(require("node:os").tmpdir(), "worker-file-"));
const file = join(folder, "written.cjs");
writeFileSync(file, `require("node:worker_threads").parentPort.postMessage("ran")`);
const worker = new Worker(file);
worker.on("message", message => console.log("message:", message));
worker.on("error", error => console.log("error:", error.code, error.message.replace(file, "<file>")));
worker.on("exit", code => {
  console.log("exit:", code);
  rmSync(folder, { recursive: true });
});
/* Output:
error: ERR_MODULE_NOT_FOUND Cannot load '<file>': it isn't in this executable, which only runs code that was compiled into it. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk.
exit: 1
*/
