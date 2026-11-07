// Benchmark for the primitive fast path in postMessage: one message read back on the same thread,
// a round trip over a MessageChannel, and a burst of messages to a Worker.

import { bench, group, run } from "../runner.mjs";
import { MessageChannel, Worker, receiveMessageOnPort } from "node:worker_threads";

// The string is the existing fast path, for comparison.
const payloads = [
  ["42", 42],
  ["1.5", 1.5],
  ["true", true],
  ["undefined", undefined],
  ['"x"', "x"],
];

const direct = new MessageChannel();

const echo = new MessageChannel();
echo.port2.on("message", message => echo.port2.postMessage(message));

// A round trip through a Worker times how long a thread takes to wake up. A burst does not: the worker counts the
// messages and replies once.
const BURST = 20000;
const counter = new Worker(
  `
    const { parentPort } = require("node:worker_threads");
    let received = 0;
    parentPort.on("message", () => {
      if (++received === ${BURST}) {
        received = 0;
        parentPort.postMessage(0);
      }
    });
  `,
  { eval: true },
);
counter.on("error", error => {
  console.error("Worker error:", error);
});

// One reply at a time: the bench awaits it before it posts again.
let settle;
echo.port1.on("message", () => settle());
counter.on("message", () => settle());
const roundTrip = payload =>
  new Promise(resolve => {
    settle = resolve;
    echo.port1.postMessage(payload);
  });
const burst = payload =>
  new Promise(resolve => {
    settle = resolve;
    for (let i = 0; i < BURST; i++) counter.postMessage(payload);
  });

// Both threads compile their handlers and the allocator gets its pages before the first burst is timed.
for (let i = 0; i < 10; i++) {
  for (const [, payload] of payloads) await burst(payload);
}

group("postMessage + receiveMessageOnPort", () => {
  for (const [name, payload] of payloads) {
    bench(`postMessage(${name})`, () => {
      direct.port1.postMessage(payload);
      return receiveMessageOnPort(direct.port2);
    });
  }
});

group("MessageChannel round trip", () => {
  for (const [name, payload] of payloads) {
    bench(`postMessage(${name})`, () => roundTrip(payload));
  }
});

group(`Worker, ${BURST} messages and one reply`, () => {
  for (const [name, payload] of payloads) {
    bench(`${BURST} x postMessage(${name})`, () => burst(payload));
  }
});

await run();

direct.port1.close();
direct.port2.close();
echo.port1.close();
echo.port2.close();
await counter.terminate();
