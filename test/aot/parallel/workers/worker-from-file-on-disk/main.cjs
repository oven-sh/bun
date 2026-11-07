// A Worker starts from a file on disk that the build has not seen.
// Flags: --aot-allow-code-from-disk
// Alone: the working directory stands for the folder that it was built in
const { Worker } = require("node:worker_threads");
const worker = new Worker(require("node:path").resolve(Buffer.from("on-disk.cjs").toString()));
worker.on("message", message => console.log("message:", message));
worker.on("error", error => console.log("error:", error.code));
worker.on("exit", code => console.log("exit:", code));
