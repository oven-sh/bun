const { parentPort } = require("node:worker_threads");
process.on("uncaughtException", (error, origin) => parentPort.postMessage(error.message + ": " + origin));
throw new Error("CommonJS entry");
