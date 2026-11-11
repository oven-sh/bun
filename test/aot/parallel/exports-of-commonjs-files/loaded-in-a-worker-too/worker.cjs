"use strict";
const { parentPort } = require("node:worker_threads");
const sum = require("./sum.cjs");
let out = "";
for (let i = 0; i < 3; i++) out += sum("w", i) + ";";
parentPort.postMessage(out);
