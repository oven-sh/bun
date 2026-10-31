const { parentPort, workerData } = require("node:worker_threads");
parentPort.postMessage([workerData + 1, require("node:path").basename(__filename)]);
