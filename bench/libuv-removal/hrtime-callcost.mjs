// hrtime-callcost.mjs — clock call cost on Windows (HYPOTHESIS-KILL script)
//
// CLAIM UNDER TEST: "removing libuv speeds up performance.now()/hrtime".
// EXPECTED RESULT: NO CHANGE — this script exists to confirm (or resurrect)
// that conclusion after each migration phase.
//
// MECHANISM: Bun's user-visible clocks on Windows are ALREADY native, not libuv:
// clock_gettime_monotonic in src/jsc/bindings/c-bindings.cpp:237 calls
// QueryPerformanceCounter directly. The only uv_hrtime callers are internal
// (NodeHTTPParser.cpp, node/http/JSConnectionsListPrototype.cpp — plan Phase 0),
// which are not exercised by these loops. If the numbers here are flat
// bun-vs-node and flat before/after, the "u128 QPC beats uv_hrtime double math"
// item (plan §3 scorecard, getaddrinfo/os_*/hrtime row) is NOT user-visible on
// these APIs and must not be claimed as a win.
//
// RUN:  bun bench/libuv-removal/hrtime-callcost.mjs
//       node bench/libuv-removal/hrtime-callcost.mjs

const isBun = typeof Bun !== "undefined";
const runtime = isBun ? `bun ${Bun.version}` : `node ${process.versions.node}`;
const N = 1_000_000;
const REPS = 5;

function bench(name, fn) {
  // warmup
  fn(100_000);
  const reps = [];
  for (let r = 0; r < REPS; r++) {
    const t0 = process.hrtime.bigint();
    fn(N);
    const t1 = process.hrtime.bigint();
    reps.push(Number(t1 - t0) / N);
  }
  reps.sort((a, b) => a - b);
  const med = reps[reps.length >> 1];
  console.error(
    `${name.padEnd(24)} ${med.toFixed(1).padStart(7)} ns/call  (min ${reps[0].toFixed(1)}, max ${reps[REPS - 1].toFixed(1)})`
  );
  return { name, nsPerCall: +med.toFixed(2), min: +reps[0].toFixed(2), max: +reps[REPS - 1].toFixed(2) };
}

let sinkNum = 0;
let sinkBig = 0n;

console.error(`# hrtime-callcost runtime=${runtime} (${N} calls, median of ${REPS})`);
const out = [];
out.push(bench("performance.now()", n => { for (let i = 0; i < n; i++) sinkNum += performance.now(); }));
out.push(bench("process.hrtime.bigint()", n => { for (let i = 0; i < n; i++) sinkBig += process.hrtime.bigint(); }));
out.push(bench("Date.now()", n => { for (let i = 0; i < n; i++) sinkNum += Date.now(); }));
if (isBun) {
  out.push(bench("Bun.nanoseconds()", n => { for (let i = 0; i < n; i++) sinkNum += Bun.nanoseconds(); }));
}
// keep sinks alive
if (sinkNum === -1 && sinkBig === -1n) console.error("impossible");
console.error("\nJSON:");
console.error(JSON.stringify({ runtime, results: out }));
