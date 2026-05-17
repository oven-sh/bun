# Codex Review — Phase 1 Section U (`crash-meta-utility`)

## Verdict

Section U's main EXP-013 conclusion is sound: the POSIX crash signal path still enters substantial non-async-signal-safe code. The inline-asm and `bun_bin` summaries checked out against current source.

## Correction Applied

The initial Section U text under-counted/over-described `src/analytics/lib.rs`:

- Current source has 9 counted unsafe sites in the keyword sweep.
- 8 of those are `#[unsafe(export_name/no_mangle)]` ABI attributes for C-visible counters/probes.
- 1 is the runtime `libc::sysctlbyname` call that reads `kern.osproductversion`.

The artifacts now distinguish "counted unsafe syntax" from "runtime unsafe operation" so the report no longer says analytics has only one unsafe site while the totals table says nine.

## Source Checks

- `src/crash_handler/lib.rs:587-590` contains the maintainer TODO admitting the mutex-in-signal-handler hazard.
- `src/crash_handler/lib.rs:1657-1673` is the POSIX signal entry.
- `src/crash_handler/lib.rs:878-1343` performs mutex locking, output flushing, formatting, report lookup, and reload/report logic.
- `src/crash_handler/lib.rs:1737` installs `SA_RESETHAND`, which is a mitigation, not a proof of async-signal-safety.
- `src/perf/hw_timer.rs:37`, `:51`, and `:154` use correct minimal inline-asm clobbers for `MRS`/`RDTSC`.
- `src/analytics/lib.rs:280-299`, `:477`, and `:518` are unsafe export/no_mangle attributes; `:395` is the sole runtime unsafe call in analytics.

## Caution for Later Phases

Do not phrase EXP-013 as "Rust UB already proven by Miri." It is a POSIX async-signal-safety contract violation and can become heap/lock UB or deadlock depending on where the signal interrupts execution. The report should keep the current wording: high-priority soundness/reliability hazard, manually confirmed by call-graph audit, not a Miri-confirmed Rust abstract-machine trace.
