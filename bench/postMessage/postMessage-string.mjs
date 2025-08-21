// Benchmark for string fast path optimization in postMessage with Workers

import { bench, run } from "mitata";
import { Worker, isMainThread, parentPort } from "node:worker_threads";

// Test strings of different sizes
const strings = {
  small: "Hello world",
  medium: Buffer.alloc("Hello World!!!".length * 1024, "Hello World!!!").toString(),
  large: Buffer.alloc("Hello World!!!".length * 1024 * 256, "Hello World!!!").toString(),
};

let worker;
let receivedCount = new Int32Array(new SharedArrayBuffer(4));
let sentCount = 0;

function createWorker() {
  const workerCode = `
    import { parentPort, workerData } from "node:worker_threads";

    let int = workerData;

    parentPort?.on("message", data => {
      Atomics.add(int, 0, 1);
    });
  `;

  worker = new Worker(workerCode, { eval: true, workerData: receivedCount });

  worker.on("message", confirmationId => {});

  worker.on("error", error => {
    console.error("Worker error:", error);
  });
}

// Initialize worker before running benchmarks
createWorker();

function fmt(int) {
  if (int < 1000) {
    return `${int} chars`;
  }

  if (int < 100000) {
    return `${(int / 1024) | 0} KB`;
  }

  return `${(int / 1024 / 1024) | 0} MB`;
}

// Benchmark postMessage with pure strings (uses fast path)
bench("postMessage(" + fmt(strings.small.length) + " string)", async () => {
  sentCount++;
  worker.postMessage(strings.small);
});

bench("postMessage(" + fmt(strings.medium.length) + " string)", async () => {
  sentCount++;
  worker.postMessage(strings.medium);
});

bench("postMessage(" + fmt(strings.large.length) + " string)", async () => {
  sentCount++;
  worker.postMessage(strings.large);
});

await run();

await new Promise(resolve => setTimeout(resolve, 5000));

if (receivedCount[0] !== sentCount) {
  throw new Error("Expected " + receivedCount[0] + " to equal " + sentCount);
}

// Cleanup worker
worker?.terminate();
