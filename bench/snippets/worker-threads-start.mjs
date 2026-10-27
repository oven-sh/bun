// A node:worker_threads Worker from `new Worker()` to 'exit', by what the worker does.
import { Worker } from "node:worker_threads";
import { bench, run } from "../runner.mjs";

const workers = {
  "empty": ``,
  "console.log": `console.log("line");`,
  "process.stdout.write": `process.stdout.write("line\\n");`,
  "require + postMessage": `require("node:worker_threads").parentPort.postMessage(1);`,
  "require + log + postMessage": `console.log("line"); require("node:worker_threads").parentPort.postMessage(1);`,
  "workerData + one reply": `
    const { parentPort, workerData } = require("node:worker_threads");
    parentPort.once("message", message => {
      parentPort.postMessage(message + workerData.add);
      parentPort.close();
    });`,
};

for (const [name, source] of Object.entries(workers)) {
  bench(name, () => {
    const worker = new Worker(source, { eval: true, stdout: true, stderr: true, workerData: { add: 1 } });
    worker.stdout?.resume();
    worker.postMessage(1);
    return new Promise(resolve => worker.on("exit", resolve));
  });
}

await run();
