const fs = require("node:fs");
require("node:worker_threads").parentPort.postMessage([process.cwd() === __dirname, fs.readFileSync("data/note.txt", "utf8").trim()].join());
