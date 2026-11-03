const { parentPort, workerData } = require("node:worker_threads");
parentPort.postMessage("of-node.cjs " + workerData);
