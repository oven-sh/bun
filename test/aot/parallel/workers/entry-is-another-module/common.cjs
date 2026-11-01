const { parentPort, isMainThread } = require("node:worker_threads");
parentPort.postMessage("CommonJS " + isMainThread + " " + typeof module + " " + (require.main === module));
