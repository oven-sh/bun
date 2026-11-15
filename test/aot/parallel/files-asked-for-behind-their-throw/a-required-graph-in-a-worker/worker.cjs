process.on("uncaughtException", error => postMessage("uncaught " + error.message));
setTimeout(() => postMessage("later " + globalThis.seen));
require("./graph.mjs");
