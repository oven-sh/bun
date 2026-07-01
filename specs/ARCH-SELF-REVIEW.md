# Self-review of ARCHITECTURE.md (v1) — findings to merge into v2

Found by the author while constructing the adversarial-review prompt, BEFORE the independent
review returned. To be merged with `specs/ARCH-REVIEW.md` into ARCHITECTURE.md v2.
Do not treat v1's §4 as frozen until v2 lands.

## S1. [CRITICAL] `SourceKind`/`SinkKind` have no `Transform` arm
`InitializeTransformStream` (digest 04) creates the readable with the *transform default
source* pull/cancel algorithms and the writable with the *transform default sink*
write/close/abort algorithms. All are spec-native algorithms that need a back-pointer to the
`TransformStream`. v1's `SourceKind` enum has no arm for them and never defines `SinkKind` at
all.
**Fix**: `SourceKind::Transform` and `SinkKind::Transform`, whose context (§S3) is the
`JSTransformStream*`. Enumerate `SinkKind { JavaScript, Transform, CrossRealm, Nothing,
/* Bun TBD */ }` explicitly.

## S2. [MAJOR] Two spec classes are missing from the class list
- **`ReadableStreamAsyncIterator`**: `stream.values({preventCancel})` / `[Symbol.asyncIterator]()`
  returns a real async-iterator object with its own prototype (`%ReadableStreamAsyncIteratorPrototype%`,
  `next()`/`return()`) and internal state (the acquired default reader, `[[ongoingPromise]]`,
  `[[isFinished]]`, `preventCancel`). It is an internal class (no globalThis constructor) but a
  distinct GC cell: **class #14, `JSReadableStreamAsyncIterator`**.
- **`ReadableStreamGenericReader`** mixin: `[[stream]]` + `[[closedPromise]]` + the `closed`
  getter + `cancel()` are shared between DefaultReader and BYOBReader. C++: an internal base
  class `JSReadableStreamGenericReader` (not exposed, no own prototype on globalThis) from
  which both readers derive; the shared slots + `visitChildren` for them live there once.

## S3. [MAJOR] Per-kind algorithm *context* is unspecified
The spec's algorithm closures capture state v1 gives no home to:
tee branch → the shared tee-state + a branch index; `ReadableStream.from` → the iterator
record (`iterator` + cached `next` method); cross-realm → the `MessagePort`; transform → the
`TransformStream`; the WS/TS sink side likewise.
**Fix**: each controller gets exactly ONE extra member, `WriteBarrier<JSC::JSCell>
m_algorithmContext`, interpreted per `SourceKind`/`SinkKind`:
`TeeBranch` → `JSStreamTeeState*` (branch index is a separate `uint8_t`);
`FromIterable` → a small `JSStreamFromIterableContext` cell `{iterator, nextMethod}`;
`CrossRealm` → the port; `Transform` → the `JSTransformStream`. The `JavaScript` kind uses
the dedicated `m_underlyingSource/m_pullMethod/m_cancelMethod` members and leaves
`m_algorithmContext` null. This keeps the controller at a fixed small size for every kind.

## S4. [MAJOR] The no-`Strong` liveness claim needs one stated invariant + one escape hatch
The §7.6 argument holds, but rests on a load-bearing fact v1 never states: **JSC's microtask
queue is a GC root**, and an in-flight pipe/pull is always reachable through EITHER a pending
microtask job OR an externally-rooted producer OR the caller's promise. If none of those hold,
the pipe can never make progress again, so collecting it is unobservable — *except* it also
means a `pipeTo` whose promise the caller discarded and whose source stalls will never
`writer.close()` the destination, which is the correct (spec) behavior anyway.
**Fix**: state the invariant explicitly in §7.6, and add the ONE sanctioned escape hatch:
if the independent review or testing shows a reachable-through-nothing case,
`JSStreamPipeToOperation` may hold a self-keepalive `JSC::Strong<JSStreamPipeToOperation>`
armed in its constructor and cleared in `finalize()` (a single, bounded, provably-released
Strong) — and nothing else in the subsystem may.

## S5. [MINOR→verify] PipeTo's AbortSignal registration must be removable
The pipe's "finalize" step removes its abort algorithm from `signal`. This requires Bun's
C++ `AbortSignal` to support add **and remove** of a native algorithm by handle. If it only
supports add, a long-lived signal roots every finished pipe forever (a real leak).
`TBD(plumbing)` — verify the API in `specs/PLUMBING.md`; if remove is missing, add it there
(a one-method addition to AbortSignal, outside this subsystem).
