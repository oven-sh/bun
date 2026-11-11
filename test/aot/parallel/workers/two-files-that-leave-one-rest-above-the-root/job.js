// Each main.js below starts this file as a Worker. Run as a program it has no parent.
import { parentPort } from "node:worker_threads";
if (parentPort) parentPort.postMessage("three folders up");
else console.log("no parent");
