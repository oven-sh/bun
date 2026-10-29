// Exit code: 3
console.log(require("node:worker_threads").isMainThread, process.argv.length);
process.exit(3);
