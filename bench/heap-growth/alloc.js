// Synthetic workload: hold LIVE_MB of live objects, then churn CHURN_MB of
// short-lived allocations. Does real work (sums) so JIT doesn't elide.
// Use objects (not typed arrays) so the memory lives in the GC'd heap.

const LIVE_MB = parseInt(process.env.LIVE_MB ?? "200", 10);
const CHURN_MB = parseInt(process.env.CHURN_MB ?? "4000", 10);
const OBJ_BYTES = 200; // rough per-object cost (cell + 8 props + backing)

const liveCount = Math.floor((LIVE_MB * 1024 * 1024) / OBJ_BYTES);
const retained = new Array(liveCount);
for (let i = 0; i < liveCount; i++) {
  retained[i] = { id: i, a: i * 2, b: i * 3, c: i & 255, d: "x".repeat(8), e: [i, i + 1, i + 2], f: null };
}

const churnCount = Math.floor((CHURN_MB * 1024 * 1024) / OBJ_BYTES);
let acc = 0;
const batch = 10000;
for (let n = 0; n < churnCount; n += batch) {
  const tmp = new Array(batch);
  for (let j = 0; j < batch; j++) {
    tmp[j] = { id: n + j, a: j, b: j * 2, c: j & 255, d: "y".repeat(8), e: [j, j, j], f: { g: j } };
  }
  for (let j = 0; j < batch; j++) acc += tmp[j].a + tmp[j].e[0];
}
// touch retained so it stays live through churn
for (let i = 0; i < liveCount; i += 1000) acc += retained[i].id;
if (acc === -1) console.log("never");
process.stderr.write(`synth done live=${LIVE_MB}MB churn=${CHURN_MB}MB acc=${acc}\n`);
