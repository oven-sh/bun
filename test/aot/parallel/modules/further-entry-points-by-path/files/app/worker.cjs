require("node:worker_threads").parentPort.postMessage("hello from " + require("node:path").basename(__filename));
