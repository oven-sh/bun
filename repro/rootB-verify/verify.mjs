// Root-B post-fix gate: one worker per iteration arms one in-flight op of
// every cross-thread completion source (public API, loopback-only), parent
// terminates mid-flight, x ITERATIONS. PASS = rc 0 + the PASS line + zero
// ASan/assert/panic. On stock canary this SIGSEGVs on the first teardown.
//
// Run under the debug+ASAN build so the fail-before is deterministic:
//   bun bd repro/rootB-verify/verify.mjs

import { Worker } from "node:worker_threads";

const ITERATIONS = Number(process.env.ROOTB_ITER ?? 100);
const body = new URL("./worker-body.mjs", import.meta.url);

for (let i = 0; i < ITERATIONS; i++) {
  const w = new Worker(body);
  // Wait for the worker to finish arming (or give up after a bound).
  const armed = await new Promise((resolve) => {
    const t = setTimeout(() => resolve("timeout"), 5000);
    w.once("message", (m) => {
      clearTimeout(t);
      resolve(m);
    });
    w.once("error", (e) => {
      clearTimeout(t);
      resolve(e);
    });
  });
  if (armed instanceof Error) {
    console.error(`iter ${i}: worker error before terminate:`, armed);
    process.exit(1);
  }
  // Small jitter so terminate lands at varying points in the in-flight work.
  const jitter = (i * 2654435761 >>> 0) % 5;
  if (jitter) await new Promise((r) => setTimeout(r, jitter));
  await w.terminate();
  if (i % 10 === 9) console.log(`… ${i + 1}/${ITERATIONS} teardowns clean`);
}

console.log(`ROOT-B VERIFY: PASS (${ITERATIONS} teardowns)`);
