# Upstream WebKit Temporal Investigation

**Target:** WebKit/WebKit @ `e84d51e6c5` (main, 2026-07-30)
**Scope:** `Source/JavaScriptCore/runtime/Temporal*.{cpp,h}`, `runtime/temporal/core/*`, `runtime/ISO8601.{cpp,h}` (~22k LOC)
**Method:** Static swarm review (33 files, refute-verified), differential fuzzing vs `@js-temporal/polyfill` and V8 native (10k seeded cases), targeted crash probes (35 adversarial inputs), ASAN + UBSan dynamic analysis, JSTests/stress suite, cross-platform verification.
**Platforms tested:** Linux x64 (Debian, clang-21, ICU 76.1, debug+ASAN + release+UBSan) · Windows x64 (Server 2019, clang-cl 21, ICU 76.1, release) · macOS (blocked — see §Cross-platform).

---

## A. Security / crash findings

### A1. `checkedCastDoubleToInt128` off-by-one allows sign-flipped Duration (correctness/security-adjacent)

**File:** `Source/JavaScriptCore/runtime/ISO8601.cpp:1755`
**Severity:** High correctness, low memory-safety risk

The overflow guard is `if (exponent >= 128)`, but a signed Int128 holds values in `(-2^127, 2^127-1]`. For an IEEE-754 double with unbiased exponent 127 (value in `[2^127, 2^128)`) the guard is not taken; the 53-bit significand is then shifted left by 75, pushing the implicit leading bit into the sign bit. In C++23 this is well-defined two's-complement wrap, so the result is a small *negative* Int128, `hasOverflowed()` stays false, and `IsValidDuration` accepts it (|result| ≪ the 9.007e24 limit).

```js
const v = (2 - 2**-52) * 2**127;          // largest double < 2^128
const d = new Temporal.Duration(0,0,0,0,0,0,0,0,0, v);
d.sign;         // -1   (should throw RangeError)
d.nanoseconds;  // -3.777893186295716e+22
```

Reproduces on Linux+ASAN and Windows release identically. Spec (`IsValidDuration`, `eqn-maxTimeDuration`) mandates a RangeError. For `v = -2**127` exactly, the later `result *= sign` additionally hits signed-multiply overflow UB, though in practice the result is rejected. Fix: change `exponent >= 128` → `exponent >= 127` at line 1755; the comment at ~1775 already says "input double >= 2^127".

### A2. `calendarDateUntil` lunisolar `largestUnit:month` is O(year_span) → DoS

**File:** `Source/JavaScriptCore/runtime/temporal/core/CalendarICUBridge.cpp:1847-1857`
**Severity:** Availability / DoS

For chinese and hebrew (lunisolar) calendars with `largestUnit:"month"`, the fixed-solar fast path at line 1775 is skipped and the year fast-forward at line 1805 only applies to `largestUnit:"year"`, so the month loop at 1847 walks **one `ucal_add(UCAL_MONTH)` per month** across the entire span.

| span (years) | chinese, debug | hebrew, debug | Windows release (chinese) |
|---|---|---|---|
| 100 | 447 ms | 32 ms | — |
| 1000 | 4 425 ms | 284 ms | — |
| 3000 | — | — | 8 601 ms |
| 4000 | — | 557 ms | — |
| 8000+ | >15 s (killed) | 3 107 ms | — |

A single attacker-supplied line (`new Temporal.PlainDate(2000,1,1,"chinese").until(new Temporal.PlainDate(275000,1,1,"chinese"),{largestUnit:"month"})`) runs for tens of minutes. All other calendars complete the same span in 3-5 ms.

### A3. `calendarDateUntil` silently returns `PT0S` on ICU boundary garbage

**File:** `Source/JavaScriptCore/runtime/temporal/core/CalendarICUBridge.cpp:1764-1770`
**Severity:** Silent wrong result

ICU's chinese calendar does not produce coherent fields for roughly ISO years ~71 000..199 999 (`ucal_get` throws) and for 200 000+ it returns fields again but they are inconsistent (e.g. ISO 275760-01-01 → chinese year 275760 month 2 day 11, which is not a valid mapping). When both `one` and `two` round-trip to the same `ucal_getMillis` value, the sign check at 1764 yields 0 and the function returns an empty Duration with no error.

```js
new Temporal.PlainDate(1582,1,1,"chinese")
  .until(new Temporal.PlainDate(275760,1,1,"chinese"),{largestUnit:"year"})
  .toString();
// "PT0S"  — should be ~P274178Y or a RangeError
// largestUnit:"day" on the same pair gives P100141458D (correct day count)
```

Reproduces on Linux and Windows (both ICU 76.1). The ICU read-back ought to be range-validated against the input before the sign comparison; alternatively, chinese/dangi should reject ISO years outside ICU's reliable window.

### A4. `Temporal.Instant.fromEpochMilliseconds`: unchecked double→int64_t conversion (C++ UB)

**File:** `Source/JavaScriptCore/runtime/TemporalInstant.cpp:204`
**Severity:** UB; not observably exploitable on x86_64/ARM64

`isInteger()` checks integrality only (not magnitude); a value like `1e300` then reaches `ISO8601::ExactTime::fromEpochMilliseconds(int64_t)` via an implicit double→int64_t conversion. Per `[conv.fpint]` this is undefined behavior. On x86_64/ARM64 `cvttsd2si`/`fcvtzs` saturate and the subsequent `isValid()` rejects it, so the observable behavior is a RangeError; a release+UBSan build did not flag it (likely folded). A sibling call site in `DatePrototype.cpp:953` guards the same conversion with an ASSERT because Date values are bounded; `fromEpochMilliseconds` has no such bound. Fix: add `if (std::abs(epochMilliseconds) > 8.64e15) throwRangeError(...)` before the cast.

### A5. Memory safety: no findings

35 adversarial probes (prototype poisoning, re-entrant getters, Proxy traps, surrogate code units, 10 MB string annotations, Symbol coercion, GC pressure, huge BigInt) under debug+ASAN: 0 heap errors, 0 assertion failures, 0 non-exception crashes. 10 000 differential-fuzz cases under ASAN: 0 crashes. UBSan surfaced only pre-existing non-Temporal alignment noise (Lexer / BytecodeGenerator / WTF::Vector memcpy-null), none in `runtime/Temporal*` or `temporal/core/`.

---

## B. Spec-conformance bugs

### B1. ISO 8601 parser still enforces removed 14-char IANA component limit

**File:** `Source/JavaScriptCore/runtime/ISO8601.cpp:701`
**Severity:** Spec bug; observable via any parse entry point

```js
Temporal.PlainDate.from("2025-01-01[" + "A".repeat(15) + "]");
// JSC: RangeError   V8: PlainDate 2025-01-01
```

The current grammar has no length cap on `TimeZoneIANANameComponent`; `ToTemporalDate` never consults the parsed `[[TimeZone]]`, so an unrecognised annotation is simply ignored. Line 701 `if (componentLength > 14)` should be removed.

### B2. `nudgeToDayOrTime` is missing the spec `truncate()` (comment is wrong)

**File:** `Source/JavaScriptCore/runtime/temporal/core/DurationArithmetic.cpp:~811`

Comment claims `totalTimeDuration` already truncates; it does not (`fractionToDouble` returns a fractional double). `didExpandDays` is therefore spuriously true on any sub-day rounding that increases magnitude, wasting a `bubbleRelativeDuration`/`calendarDateAdd` call. Traced scenarios show the spurious bubble is a no-op on output, so this is latent correctness + measurable perf.

### B3. `disambiguatePossibleEpochNanoseconds` gap branch skips `IsValidEpochNanoseconds`

**File:** `Source/JavaScriptCore/runtime/temporal/core/TimeZoneICUBridge.cpp:425-427`

The spec re-invokes `GetPossibleEpochNanoseconds` on the shifted datetime, which range-checks each candidate; JSC directly constructs `ExactTime(naiveNs - gap.*Ns)` and returns it. Mostly masked by `TemporalZonedDateTime::tryCreate`'s re-check, but `addZonedDateTime` (line 490) feeds the unvalidated intermediate into further arithmetic, so a transiently-out-of-range intermediate that the normalized duration pulls back in range would succeed where the spec requires RangeError. No deterministic repro (requires a DST gap adjacent to the ±1e8-day boundary under ICU's far-future rules).

---

## C. Environment / ICU-dependent

### C1. `JSTests/stress/temporal-calendar-canonical-set.js` fails under ICU 76.1

On both Linux (system libicu 76.1) and Windows (ICU4C 76.1 download) the test asserts `Temporal rejects islamic` but JSC accepts it, because `intlAvailableCalendars()` inherits `islamic` and `islamic-rgsa` from ICU data. The test was written for an ICU that excludes these (or for the `--useIntlEraMonthcode=1` filtering path not being the default). This is exactly the "ICU differences" risk: the same binary passes or fails depending solely on the ICU data shipped alongside it.

### C2. ICU chinese-calendar reliable range

ICU 76's `Calendar` for `chinese` stops returning consistent fields beyond ~ISO year 70 000 and returns a different kind of garbage beyond ~200 000 (see A3). This is an ICU limitation, but JSC currently surfaces it as either a RangeError *or* silent wrong output depending on code path; it should be one or the other consistently.

---

## D. Build / platform issues found incidentally

### D1. Windows JSCOnly build broken with Windows SDK ≥10.0.26100

`winnt.h` defines `RotateLeft32`/`RotateLeft64`/`RotateRight32`/`RotateRight64` as macros. `AirOpcodeGenerated.h` already has a `push_macro`/`undef`/`pop_macro` guard, but the `#include "CCallHelpers.h"` block sits **after** the `#undef` and transitively re-includes `winnt.h`, re-defining the macros before the enum `case Opcode::RotateLeft32:` uses start at line ~13883. Workaround applied locally: add a second `#undef` block immediately after the `#include`s. Proper fix: move the `#include` lines above the `push_macro` block in `opcode_generator.rb`.

### D2. LeakSanitizer reports process-lifetime `AtomStringImpl`/`WatchpointSet` allocations

`USE_SYSTEM_MALLOC=ON` + ASAN on a fresh JSCOnly build reports direct leaks from `IdentifierArena::makeIdentifier` and `InlineWatchpointSet::inflate` on a trivial `-e 'print(1)'`. These are pre-existing and not Temporal-specific; noted because anyone reproducing A1-A3 under LSan will see them.

---

## E. Not-a-bug / false positives ruled out

- **`PlainYearMonth.prototype.add({days:1})` throws** in JSC but succeeds in V8 and the polyfill (53/161 fuzz divergences). JSC is **correct**: tc39/proposal-temporal#3197 (merged 2026-01-13) made sub-month units a RangeError in `AddDurationToYearMonth`. V8 26.3 and @js-temporal/polyfill 0.5.1 implement the pre-change behavior.
- **`Duration.compare({days:2**32}, ...)`** — polyfill divergence only; JSC and V8 agree.
- **Non-ISO calendar field access at extreme years** (33 divergences): JSC returns values where the polyfill throws. These are within the implementation-defined `NonISODateUntil` latitude and/or polyfill limitations; not filed.

---

## F. Tooling produced

All under `/tmp/temporal-fuzz/` on the Linux host:
- `gen.js` — seeded generator, 33 shape families covering every public constructor/method, edge-value pools for years/durations/calendars/timezones/rounding modes.
- `diff-fuzz.js` — driver: batches generated cases, runs jsc vs polyfill, auto-bisects crashes and hangs, writes `out/summary.json`.
- `temporal-crash-probe.js` — 35 hand-written adversarial inputs.

Reproduced bugs A1-A3, B1 on both Linux and Windows with identical output.
