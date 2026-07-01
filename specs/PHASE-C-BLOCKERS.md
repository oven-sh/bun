# Phase-C blockers

**NONE.** Every build error was mechanical and fixed inline; no item required changing a
frozen `streams/` header, a signature, or a design decision.

## Non-blocker findings recorded for the ledger

### 1. Unified-source bundling vs. the streams TUs (fixed at the BUILD layer, round 1 → round 2)

Round 1's 12 compile errors were ALL one class: the build system bundles `webcore/streams/*.cpp`
8-at-a-time into `UnifiedSource-*.cpp` TUs, which collides the file-local `static` helpers that
Phase B deliberately duplicated across TUs (`invokeMethod`, `invokePromiseReturningMethod`,
`byteControllerOf`, `defaultControllerOf`, `convertQueuingStrategyInit`,
`transformReadableController`). Every individual streams TU is CLEAN (33/33 verified).

Fix: added a `noUnifyDirs` list to `scripts/build/unified.ts` containing
`src/jsc/bindings/webcore/streams` — the directory compiles standalone, one .o per .cpp.
Zero streams code changed. Phase D's already-planned "dedup the file-local helpers" pass can
lift the exclusion if it wants unified bundling back.

### 2. RUNTIME bug found and fixed post-exit-criterion: `performPromiseThenWithContext` with an
   undefined result capability + a non-callable handler (4 sites, 2 files)

Symptom (100% reproducible): `new ReadableStream({...}).tee()` followed by `getReader().read()`
on either branch produced the CORRECT values but ALSO fired an uncaught
`TypeError: undefined is not an object` (no stack) from a promise-reaction microtask.

Root cause (verified against the JSC fork source, `JSPromise.cpp:654` /
`JSMicrotask.cpp:1662-1706`): `JSPromise::performPromiseThenWithContext(vm, g, onFulfilled,
onRejected, promiseOrCapability, ctx)` routes a settlement whose handler is NOT callable through
`InternalMicrotask::PromiseResolveWithoutHandlerJob`, whose slow path does an unconditional
`capability.get("resolve")`. Unlike `PromiseReactionJob` (which early-returns on
`promiseOrCapability.isUndefinedOrNull()`), it does NOT tolerate an undefined capability.
So the "one-sided reaction handler + no result promise" pattern that ARCHITECTURE.md assumed to
be safe is only safe when BOTH handler slots are callable.

The 4 (and only 4) call sites in the whole subsystem that hit this class:

| file:line | source promise | missing handler | user-reachable trigger |
|---|---|---|---|
| `ReadableStreamOperations.cpp:992` | `reader.closed` (default tee) | onFulfilled | any `.tee()` whose source closes normally |
| `ReadableStreamOperations.cpp:1003` | `reader.closed` (byte tee) | onFulfilled | any byte-stream `.tee()` |
| `JSStreamPipeToOperation.cpp:132` | `writer.ready` | onRejected | `pipeTo()` to a writable that errors |
| `JSStreamPipeToOperation.cpp:555` | `writer.ready` | onRejected | same |

Fix (mechanical .cpp bodies only; no header / signature / ABI change): substitute the runtime's
already-shared `onReturnUndefined()` no-op handler for the missing side. For pipeTo the fix
lives in the shared `registerPipeReaction()` helper, so the whole class is impossible there;
the two tee sites are direct calls and were fixed in place. Every other
`performPromiseThenWithContext` site in the subsystem was audited (38 total): all others either
pass a REAL result promise or have both handlers callable.

Suggested Phase-D follow-up (out of Phase-C scope): fix `promiseResolveWithoutHandlerJob` in
the WebKit fork to early-return on an undefined capability (mirroring `PromiseReactionJob`),
then the C++ can go back to the one-sided form.
