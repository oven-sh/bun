// A function that calls `eval` starts a Worker of node:worker_threads where a `--define` whose value is `threads.Worker` is the constructor. The evaluated text could declare `threads`. The build compiles the file that the Worker starts from, as where the path is spelled.
// Flags: --define W=threads.Worker
const threads = require("node:worker_threads");
function start() {
  eval("");
  return new W(__dirname + "/w.cjs");
}
const worker = start();
worker.on("message", message => console.log(message));
worker.on("error", error => console.log("error:", String(error).split("\n")[0]));
