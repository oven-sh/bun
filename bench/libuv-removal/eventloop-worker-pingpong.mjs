// eventloop-worker-pingpong.mjs
//
// CLAIM (conditional): cross-thread wakeup latency (worker_threads postMessage
// round-trip) improves modestly when uv_async wakeups are replaced by direct
// native-IOCP posts. Today each direction is: enqueue task -> us_wakeup_loop ->
// uv_async_send = atomic flag + PostQueuedCompletionStatus (libuv
// src/win/async.c:83-100) -> target uv_run dequeues the packet via GQCSEx,
// trampolines it through uv__insert_pending_req -> uv__process_async_wakeup_req
// -> uSockets async_cb -> Bun wakeup handler, inside a full uv_run(ONCE) phase
// walk (libuv src/win/core.c:701+). The native loop posts to its own IOCP and
// dispatches the wakeup directly from the GQCSEx batch — the handle-layer
// trampoline and phase walk go away; the PQCS syscall itself stays.
//
// MEASURED 2026-06-29 (Win11, 24 cores, bun 1.4.0 vs node 25.8.1):
//   bun 52.8k RT/s med (19.0us/RT, spread 43.8k..61.7k)
//   node 59.5k RT/s med (16.8us/RT, spread 46.9k..64.5k)
// VERDICT: NOT a libuv-removal win. ~19us/RT is dominated by structuredClone
// serialization + JS dispatch; the uv_async trampoline is well under 1us of
// it, and run-to-run spread (+/-15%) exceeds the plausible gain. Kept as a
// regression guard for the the removal wakeup rewire, not as a perf claim.
//
// RUN:  bun  bench/libuv-removal/eventloop-worker-pingpong.mjs
//       node bench/libuv-removal/eventloop-worker-pingpong.mjs

import { Worker } from "node:worker_threads";

const now = () => process.hrtime.bigint();
const WARMUP = 500;
const ROUNDS = 5_000;
const REPEATS = 5;

const workerSrc = `
const { parentPort } = require("node:worker_threads");
parentPort.on("message", m => parentPort.postMessage(m));
`;

function pingPong(worker, rounds) {
  return new Promise((resolve, reject) => {
    let i = 0;
    const t0 = now();
    const onMsg = () => {
      if (++i >= rounds) {
        worker.off("message", onMsg);
        return resolve(Number(now() - t0));
      }
      worker.postMessage(i);
    };
    worker.on("message", onMsg);
    worker.postMessage(0);
  });
}

const runtime = typeof Bun !== "undefined" ? `bun ${Bun.version}` : `node ${process.version}`;
console.log(`# worker_threads postMessage ping-pong — ${runtime} on ${process.platform}`);

const worker = new Worker(workerSrc, { eval: true });
let done = false;
const fatal = new Promise((_, reject) => {
  worker.on("error", reject);
  worker.on("exit", code => {
    // terminate() after a finished run reports a nonzero code on node; only
    // treat exit as fatal while the measurement is still in flight.
    if (!done && code !== 0) reject(new Error(`worker exited early with code ${code}`));
  });
});

const run = (async () => {
  await pingPong(worker, WARMUP);
  const rates = [];
  for (let r = 0; r < REPEATS; r++) {
    const ns = await pingPong(worker, ROUNDS);
    rates.push(ROUNDS / (ns / 1e9));
  }
  rates.sort((a, b) => a - b);
  const med = rates[Math.floor(rates.length / 2)];
  console.log(
    `round-trips/s: med ${med.toFixed(0)}  spread ${rates[0].toFixed(0)}..${rates[rates.length - 1].toFixed(0)}  ` +
      `(${(1e6 / med).toFixed(1)} us/round-trip, ${ROUNDS} rounds x${REPEATS})`,
  );
  console.log(
    JSON.stringify({
      runtime,
      rt_per_s_med: +med.toFixed(0),
      us_per_rt: +(1e6 / med).toFixed(2),
      spread: [+rates[0].toFixed(0), +rates[rates.length - 1].toFixed(0)],
    }),
  );
  done = true;
  await worker.terminate();
})();

await Promise.race([run, fatal]);
process.exit(0);
