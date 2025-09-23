// Benchmark for object fast path optimization in postMessage with Workers

import { bench, run } from "mitata";
import { Worker } from "node:worker_threads";

const extraProperties = {
  a: "a!",
  b: "b!",
  "second": "c!",
  bool: true,
  nully: null,
  undef: undefined,
  int: 0,
  double: 1.234,
  falsy: false,
};

const objects = {
  small: { property: "Hello world", ...extraProperties },
  medium: {
    property: Buffer.alloc("Hello World!!!".length * 1024, "Hello World!!!").toString(),
    ...extraProperties,
  },
  large: {
    property: Buffer.alloc("Hello World!!!".length * 1024 * 256, "Hello World!!!").toString(),
    ...extraProperties,
  },
};

let worker;
let receivedCount = new Int32Array(new SharedArrayBuffer(4));
let sentCount = 0;

function createWorker() {
  const workerCode = `
    import { parentPort, workerData } from "node:worker_threads";

    let int = workerData;

    parentPort?.on("message", data => {
      switch (data.property.length) {
        case ${objects.small.property.length}:
        case ${objects.medium.property.length}:
        case ${objects.large.property.length}: {
          if (
            data.a === "a!" && 
            data.b === "b!" && 
            data.second === "c!" && 
            data.bool === true && 
            data.nully === null && 
            data.undef === undefined && 
            data.int === 0 && 
            data.double === 1.234 && 
            data.falsy === false) {
            Atomics.add(int, 0, 1);
            break;    
          }
        }
        default: {
          throw new Error("Invalid data object: " + JSON.stringify(data));
        }
      }
      
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
bench("postMessage({ prop: " + fmt(objects.small.property.length) + " string, ...9 more props })", async () => {
  sentCount++;
  worker.postMessage(objects.small);
});

bench("postMessage({ prop: " + fmt(objects.medium.property.length) + " string,    ...9 more props })", async () => {
  sentCount++;
  worker.postMessage(objects.medium);
});

bench("postMessage({ prop: " + fmt(objects.large.property.length) + " string,     ...9 more props })", async () => {
  sentCount++;
  worker.postMessage(objects.large);
});

await run();

await new Promise(resolve => setTimeout(resolve, 5000));

if (receivedCount[0] !== sentCount) {
  throw new Error("Expected " + receivedCount[0] + " to equal " + sentCount);
}

// Cleanup worker
worker?.terminate();
