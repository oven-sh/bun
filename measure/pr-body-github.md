> **On hold since 2026-11-11. Do not merge this head.** With no `'uncaughtException'` handler the stream reads on after the report, and a program that exits with its child's code from `child.on("close")` exits 0 where Node and main exit 1. The [status comment](https://github.com/oven-sh/bun/pull/37171#issuecomment-5951296651) has the script and the plan. The text below describes the change as first written and its last line of "Verification" about the case with no handler is not complete.

### Repro

```js
import { spawn } from "node:child_process";
let ue = 0, ur = 0, data = 0, n = 0; const N = 40;
process.on("uncaughtException", (e, origin) => { origin === "unhandledRejection" ? ur++ : ue++; next(); });
process.on("unhandledRejection", () => { ur++; next(); });
process.on("exit", (code) => console.log(`exit=${code} spawned=${n} data=${data} uncaughtException=${ue} unhandledRejection=${ur}`));
function next() {
  if (n >= N) return; n++;
  const c = spawn("/bin/sh", ["-c", "echo hi"], { stdio: ["ignore", "pipe", "ignore"] });
  c.stdout.on("data", () => { data++; throw new Error("data-throw-" + n); });
}
next();
```

node: `exit=0 spawned=40 data=40 uncaughtException=40 unhandledRejection=0`

bun before this change: `exit=0 spawned=3 data=2 uncaughtException=1 unhandledRejection=1`. After a few children the listener throw arrives as an unhandledRejection, the rejection is only noticed at loop exit (after `beforeExit`), and the child spawned from that handler never runs. With only an uncaughtException handler installed the flipped throw is fatal (rc 1). The throwing stream also stalls: its `'close'` never fires.

Delaying the child's first write makes the failure deterministic, because the parent's pull is then always pending when data arrives: bun reports `ue=0 ur=3 closes=0` vs node `ue=3 ur=0 closes=3` on every run.

### Cause

`internal/streams/native-readable.ts` drives child stdio pipes. When `ptr.pull()` returns a promise, `handleResult()` -> `push()` -> `emit('data')` runs inside the `.then` fulfillment reaction, and nothing observes `_read()`'s returned promise. A throw from the user's listener therefore rejects an unobserved promise and surfaces as unhandledRejection, where node, which dispatches these events from the native read callback, produces an uncaughtException. The throw also unwinds `addChunk` before its `maybeReadMore` call and `handleResult` before its EOF scheduling, so nothing ever reads again: the stream stalls and `'close'` never fires, which is why a child spawned from the late rejection handler was lost.

This is the same callback-dispatch class #34660 fixed for fs/dns/pbkdf2 callbacks, at a site it did not cover.

### Fix

Catch the throw at the push boundary in `pushAndCheck`, report it through the same `jsFunctionReportUncaughtException` path the guarded callbacks use, and schedule the read the throw unwound so the stream still reaches EOF. This applies to child stdio only (`child.stdout`, `child.stderr`), which are native handles in Node. `Readable.fromWeb` streams, fetch bodies included, keep their promise semantics. Node reports a listener throw there as an unhandledRejection too (verified against Node v26).

### Verification

- New test in `test/js/node/child_process/child_process.test.ts` fails unfixed (`spawned=3 data=3 closes=0 ue=0 ur=3`) and passes fixed (`spawned=3 data=3 closes=3 ue=3 ur=0`).
- The 40-child repro above matches node exactly with the fix, 3/3 runs.
- With only an uncaughtException handler installed: exit 0 and all children complete (was fatal rc 1).
- With no handler installed: still fatal with rc 1, as in node.
- `child_process.test.ts` (61 pass; 2 env-dependent failures reproduce on clean main in the same container), `child-process-stdio.test.js`, `child_process-node.test.js`, `node-stream.test.js`, `process-stdin.test.ts`, and `test/js/bun/spawn/spawn.test.ts` are unchanged.

<!-- robobun:evidence:begin -->

---

**no test proof** · iteration 0 · platform-specific test(s) that do not run on this machine, deferring to CI, which covers all platforms: test/js/node/stream/node-stream.test.js, test/js/node/child_process/child_process.test.ts

<!-- robobun:evidence:end -->


