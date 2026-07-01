# JSReadableStream.cpp — Lens A (spec-step fidelity) review

File: `src/jsc/bindings/webcore/streams/JSReadableStream.cpp` (802 LOC)
Ground truth: `specs/digest/01-readable-classes.md` (§ReadableStream), `specs/BUN-LAYER-DESIGN.md` §1/§1.1/§1.2/§3.4/§7.2/§7.3/§8, `specs/PHASE-B-LOG.md`.
`python3 specs/check-streams.py` → CLEAN.

I diffed every observable operation (each `[[Get]]`, each coercion, each throw, each branch)
against the digest's numbered steps and WebIDL's argument/dictionary conversion rules, and the
Bun members against BUN-LAYER §1's caller table. One concrete divergence found; it is against
the LETTER of BUN-LAYER §3.4 while matching that section's own cited source, so it needs a
ruling, not necessarily a code change.

---

### [MINOR] §3.4 prototype `text/json/bytes/blob` brand check: synchronous plain `TypeError` vs the doc's "`ERR_INVALID_THIS` rejection"

**Ground truth** — BUN-LAYER-DESIGN §3.4:

> Already C++ (`JSReadableStream.cpp:168-177`) — today thin wrappers … They become one-line
> calls to the native implementations in §3.1. … **Same brand check (`ERR_INVALID_THIS`
> rejection).**

**.cpp** — lines 715–753, all four identical, e.g. `text` (719–721):

```cpp
auto* stream = dynamicDowncast<JSReadableStream>(callFrame->thisValue());
if (!stream) [[unlikely]]
    return throwThisTypeError(*lexicalGlobalObject, scope, "ReadableStream"_s, "text"_s);
```

**Divergence (observable):** `ReadableStream.prototype.text.call({})` in the port throws a
**synchronous plain `TypeError`** (WebCore `throwThisTypeError`, no `.code` property). The
§3.4 letter demands a **rejected promise** carrying an **`ERR_INVALID_THIS`**-coded error
(`err.code === 'ERR_INVALID_THIS'`). Both the completion kind (throw vs. reject) and the
error's `.code` are observable to JS.

**Adjudication note (why this is MINOR, not MAJOR):** §3.4's own sentence says "**Same** brand
check" and cites the legacy `JSReadableStream.cpp:168-177`. That legacy source
(`src/jsc/bindings/webcore/JSReadableStream.cpp:88-96`, `jsReadableStreamProtoFuncText` etc.)
does exactly what the new file does: `dynamicDowncast` + `throwThisTypeError(...)`, a
synchronous plain `TypeError` with no `code`. So the parenthetical "(`ERR_INVALID_THIS`
rejection)" contradicts both the "Same brand check" clause and the source line it cites; the
implementation followed the cited source over the derived prose, which PHASE-B has already
ratified as the correct precedence once (BunStreamSource item: "the agent followed the cited
ground truth over the derived doc"). Do NOT also confuse this with §3.1's step-1 for the free
`Bun.readableStreamTo*` functions, which is a *different* check (`ERR_INVALID_ARG_TYPE`,
synchronous) and is not this file's.

**Minimal fix:** get a ruling. (a) If today's behavior is the contract (my reading): record a
one-line erratum against §3.4 ("brand failure is a synchronous plain `TypeError` via
`throwThisTypeError`, exactly as in the legacy file"); zero code change. (b) If the §3.4
letter is intended: replace the 4 `return throwThisTypeError(...)` lines with
`return JSValue::encode(promiseRejectedWith(lexicalGlobalObject, Bun::createError(lexicalGlobalObject, Bun::ErrorCode::ERR_INVALID_THIS, "..."_s)))`.
Either way it is a 4-line, single-site-class decision.

---

## Verified clean

Everything else was diffed step-by-step and matches; recording the load-bearing checks so the
"only one finding" verdict is auditable.

**Constructor (lines 326–381) — exact digest step order + WebIDL conversion order.**
- Observable effect order is exactly WebIDL + digest steps 1–5: (i) arg0 `optional object`
  check — explicit `undefined` ⇒ missing ⇒ `null` (line 334); `null`/primitive ⇒ `TypeError`
  (336) — (ii) arg1 `QueuingStrategy` dictionary conversion (340, `convertQueuingStrategy`) —
  (iii) `newTarget.prototype` lookup / structure (343) — (iv) constructor step 2: the
  `UnderlyingSource` dictionary conversion (347) — (v) step 3 `initializeReadableStream`
  (350) — (vi) the per-`type` branch. So `strategy.highWaterMark`/`strategy.size` getters run
  strictly BEFORE any `underlyingSource` getter (the WPT-tested ordering), and the source
  conversion runs strictly before `InitializeReadableStream`.
- `UnderlyingSource` members read in EXACT alphabetical order, one `[[Get]]` each:
  `autoAllocateChunkSize` (153) → `cancel` (161) → `pull` (171) → `start` (181) → `type` (191).
  Each present, non-undefined, non-callable callback member throws `TypeError` DURING
  conversion (164/174/184). `autoAllocateChunkSize` uses
  `convertToIntegerEnforceRange<uint64_t>` = `[EnforceRange] unsigned long long` (156).
- `type`: absent/undefined ⇒ no read beyond the one `[[Get]]`; present ⇒ `ToString` (194,
  observable, can throw) then `"bytes"` ⇒ Bytes, `"direct"` ⇒ Bun Direct, ANY other string ⇒
  `TypeError` (202) — matches the digest's `ReadableStreamType` rule ("any value other than
  `"bytes"` or undefined throws") extended by exactly one Bun value.
- `QueuingStrategy` members in alphabetical order `highWaterMark` (114, `ToNumber` = IDL
  `unrestricted double`) then `size` (123, non-callable ⇒ `TypeError`). `undefined`/`null`
  strategy ⇒ empty dict; other non-object ⇒ `TypeError` (107).
- Byte branch (362–370): `strategy["size"]` exists ⇒ **RangeError** (364);
  `extractHighWaterMark(strategy, 0)` (365, verified: WebStreamsMisc.cpp:26 throws RangeError
  on NaN/negative); `setUpReadableByteStreamControllerFromUnderlyingSource(this, source, dict, hwm)`.
  Default branch (371–378): `extractSizeAlgorithm` then `extractHighWaterMark(strategy, 1)`,
  then `setUpReadableStreamDefaultControllerFromUnderlyingSource(..., sizeAlgorithm)` — digest
  step 5 order exactly.
- Direct branch (356–361): **NO controller created**; `m_bunMode = DirectPending`,
  `m_directUnderlyingSource` set — BUN-LAYER §1/§1.1 exactly. All arms write the stream-level
  `m_bunHighWaterMark` (+ `m_bunHighWaterMarkIsNumber` per §4.1) — §1's "ALL FOUR arms" rule
  (`QueuingStrategyDict::highWaterMark` is `std::optional<double>`, so hwm `0` is stored).
- `$asyncContext` snapshot in `finishCreation` (435–436) = §8's construction-time write
  (empty vs `undefined` are both "no snapshot" per §8's RAII-helper contract).

**Methods vs digest 01.**
- `locked` (519–527): brand check ⇒ `TypeError`; returns `isReadableStreamLocked(stream)` —
  verified (ReadableStreamOperations.cpp:145-148) to be the §1.2 UNIFIED predicate
  `m_reader || m_lockedWithoutReader || nativeHandleDetached()` (transferred / `-1` ⇒ locked).
- `cancel` (529–541): bad `this` ⇒ **rejected** promise (promise-returning op); locked ⇒
  rejected `TypeError`; then `ReadableStreamCancel(this, reason)`. Does **NOT** materialize —
  §1.1 caller table.
- `getReader` (543–580): options dict per WebIDL (`null`/`undefined` ⇒ empty; non-object ⇒
  `TypeError`; one `mode` `[[Get]]`; `undefined` ⇒ absent; else `ToString`, ≠"byob" ⇒
  `TypeError`). Default mode ⇒ `materializeIfNeeded` then `acquireReadableStreamDefaultReader`;
  `{mode:"byob"}` ⇒ acquire BYOB **without** materializing — both digest step 1/3 and the §1.1
  caller table exactly.
- `tee` (654–670): `ReadableStreamTee(this, false)` and a fresh 2-element array;
  materialization is correctly DELEGATED (verified `readableStreamTee`,
  ReadableStreamOperations.cpp:1191, calls `materializeIfNeeded` first per §7.2).
- `pipeThrough` (582–618): exact validation order = brand(this) → transform must be object →
  `readable` `[[Get]]` + ReadableStream brand → `writable` `[[Get]]` + WritableStream brand
  (required members, alphabetical) → `StreamPipeOptions` conversion (`preventAbort`,
  `preventCancel`, `preventClose`, `signal` — alphabetical; non-AbortSignal `signal` ⇒
  `TypeError`) → step 1 `IsReadableStreamLocked(this)` → step 2 `IsWritableStreamLocked` →
  `ReadableStreamPipeTo(preventClose, preventAbort, preventCancel, signal)` →
  `markPromiseAsHandled` → **returns `transform["readable"]`**. All synchronous throws (not
  rejections) — correct, `pipeThrough` is not promise-returning.
- `pipeTo` (620–652): every failure (bad this, non-WritableStream destination, options
  conversion — via the `TOP_EXCEPTION_SCOPE` + `takeAbruptCompletion` catch — locked source,
  locked destination) is a **rejected promise**, in exactly WebIDL's order: destination arg,
  then options arg, then step 1 (source locked), then step 2 (dest locked), then
  `ReadableStreamPipeTo`. (Body `RETURN_IF_EXCEPTION` after the `!` op is the PHASE-B-ratified
  pattern, not a divergence.)
- `values` / `@@asyncIterator` (403–410, 672–702): `@@asyncIterator` is the SAME function
  object as `values` (DontEnum); options dict converted first (one `preventCancel` `[[Get]]`,
  `ToBoolean`), then materialize (Bun), then `AcquireReadableStreamDefaultReader` (throws if
  locked) and the iterator's `reader` / `prevent cancel` are set — digest's async-iterator
  initialization steps + §7.3's decided spec-native iterator.
- static `from` (704–711): `ReadableStreamFromIterable(argument(0))`, installed on the
  constructor with length 1. (Zero-arg call: WebIDL's required-arity `TypeError` vs. the
  delegated `GetIterator(undefined)` `TypeError` differ only in message — not an observable
  divergence in completion type; noted, not a finding.)
- Bun private accessors (757–800): `$bunNativePtr` getter returns `nativePtrForJS()` (the
  `-1`-when-transferred unification, §1.2), `$bunNativeType`, `$disturbed` — all present.
- Lengths/names: constructor 0, `pipeThrough` 1, `pipeTo` 1, everything else 0; `from` 1 —
  all per WebIDL (the legacy table's wrong `pipeThrough.length === 2` is corrected).

**Bun caller table (§1.1) — as exercised by this file:** `getReader()` default materializes;
`getReader({mode:"byob"})` does not; `values()` materializes; `cancel()` does not;
`tee()`/`pipeTo`/`pipeThrough` delegate to ops that materialize internally (verified). ✔

### Verdict

- Spec-step fidelity of this file is **excellent**: the constructor's conversion/step order,
  the alphabetical one-`[[Get]]` dictionary reads, the byte/default/direct branch split, and
  every method's numbered steps (including `pipeThrough`/`pipeTo` validation order and
  throw-vs-reject discipline) match the digest exactly; the Bun materialization caller table
  and the unified `locked` predicate match BUN-LAYER §1.
- ZERO CRITICAL, ZERO MAJOR. One MINOR: the §3.4 "(`ERR_INVALID_THIS` rejection)" wording vs
  the implemented (and legacy-identical) synchronous plain `TypeError` — a doc-vs-cited-source
  contradiction that needs a one-line ruling.
- Recommend: ship as-is for lens A; record the §3.4 erratum (or the 4-line change if the
  maintainer rules the other way).
