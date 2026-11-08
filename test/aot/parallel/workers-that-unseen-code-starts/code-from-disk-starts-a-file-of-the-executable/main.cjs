// A file from disk starts a file of the executable as a Worker of node:worker_threads and takes what it prints. No file of the executable names that module.
// Bun loads it in the thread before the file of the Worker runs, and there it stores a console and members of process.
// Flags: --aot-allow-code-from-disk
// Entry points: ./job.cjs
// Alone: the file on disk is looked for from the working directory
require(Buffer.from(process.cwd() + "/unseen.cjs").toString())("./job.cjs").then(console.log);
