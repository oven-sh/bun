require("node:worker_threads").parentPort.postMessage("the file ran: " + require("node:path").basename(__filename));
