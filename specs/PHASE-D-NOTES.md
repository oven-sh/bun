# Phase D notes — follow-ups carried out of Phase C

Recorded when Phase C was committed. Each item is real, deferred deliberately, and
none blocks correctness of the committed tree.

## Follow-ups (do in Phase D or as separate PRs)
1. **WPT re-record**: run the vendored suite against the new implementation and
   re-record `test/js/third_party/wpt-streams/expectations.json` from scratch
   (the recorded failures/crashes/timeouts describe the OLD implementation).
2. **Dedup the per-TU static helpers** in `src/jsc/bindings/webcore/streams/`
   (`invokePromiseReturningMethod` x5, `queueReactionJob` x3, `structureForNewTarget`
   x10, ...) into shared internal helpers, then **lift the `noUnifyDirs` entry** in
   `scripts/build/unified.ts` (it exists only because of those collisions).
3. **`startJSSinkController`** (`BunStreamSource.cpp`) hand-lists the 6 generated
   JSSink controller classes that `src/codegen/generate-jssink.ts`'s `classes[]`
   owns. Either emit the dispatcher from the generator or add a guard comment in
   both places. (A 7th class would today throw "Unknown direct controller" at runtime.)
4. **`BunStreamConsumers.h`'s doc comment** still tells callers to write
   `$newCppFunction("BunStreamConsumers.cpp", ...)`; the working form (and the one
   `native-readable.ts` uses) is the path-qualified `"streams/BunStreamConsumers.cpp"`.
   Fix the comment (or add `webcore/streams` to the generated-TU include path and
   revert to the bare form).
5. **`Bun.readableStreamTo*` descriptor change** (intentional, documented in the PR):
   the JSBuiltin->native LUT swap made them `DontDelete` like every neighboring
   native `Bun.*` function; they were previously configurable.
6. **Direct-controller non-promise read requests** (`PHASE-B-LOG` ruling + the
   contract audit): the flush/close delivery is by request kind now, but the clean
   long-term shape is an `onPull(readRequest)`-style API (one additive X-macro
   handler). Only matters for tee()/for-await/pipeTo over a `type:"direct"` stream.
7. **Comment-slimming pass** over `src/jsc/bindings/webcore/streams/*.{h,cpp}`
   before the PR (the recorded plan): keep only durable invariant/ownership/SAFETY
   comments; the headers carry contract comments that are load-bearing, the .cpp
   step markers should be terse.

## Verification probes (also useful as future tests)
- `specs/probes/sync-throw-matrix.js` — every user-algorithm sync-throw vs
  returned-rejection combination (caught the invokePromiseReturningMethod bug).
- `specs/probes/adversarial-smoke.js` — 10 adversarial end-to-end scenarios
  (error propagation, release-with-pending-read, abort-both, direct, BYOB,
  async iteration, tee+cancel, transform flush, writer error propagation).
Phase D should promote both into `test/js/web/streams/` as real bun tests.
