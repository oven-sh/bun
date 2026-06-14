# EXP-038 Reclassification — `AnyTaskJob::run_task` Panic Path

Date: 2026-05-16

## Verdict

EXP-038 is **NO_EVIDENCE for current production UB** under Bun's configured
profiles.

The previous standalone witness is real for a `panic = "unwind"` model: a panic
inside the `C::run` analogue skips the trailing enqueue and leaks the job.
That is not Bun's configured execution model. Current `Cargo.toml` sets:

- `[profile.dev] panic = "abort"`
- `[profile.release] panic = "abort"`
- release-derived profiles inherit `panic = "abort"`
- `[profile.shim] panic = "abort"`

`src/bun_core/lib.rs:2701-2707` and `src/crash_handler/lib.rs:1797-1804` also
document the policy explicitly: Rust panics route through the crash-handler hook
and abort before unwinding, so `catch_unwind` boundaries are unreachable.

There are still source-local comments that describe unwind-era assumptions
(`src/install/windows-shim/BinLinkingShim.rs:158`,
`src/install/PackageManager/PackageManagerEnqueue.rs:1725-1729`, and the
`panic!()` contrast comments in the Phase-A `src/runtime/bake/DevServer.rs`
draft). Treat those as stale or local hardening comments unless a profile check
proves an actual supported unwind build. The root workspace profiles above are
the current authority for the production UB verdict.

Therefore a `panic!()` in `AnyTaskJobCtx::run` aborts the process. It does not
unwind through the WorkPool callback, does not cross a C++/C FFI frame as an
unwind, and does not leave a live process with a leaked `KeepAlive`.

## What Remains True

- `AnyTaskJobCtx::run` should document the panic contract: panics are fatal.
- The standalone `panic = "unwind"` witness remains useful if a test harness,
  custom profile, or future refactor re-enables unwinding for this path.
- Adding `catch_unwind` inside `run_task` is not the right recommended fix under
  Bun's current policy; it contradicts the project-wide panic-abort design.

## Artifact Rule

Do not count EXP-038 as current UB or as a current leak/Drop-skip bug. Count it
as:

- `NO_EVIDENCE` for current production UB.
- Panic-policy documentation / regression guard if a future profile enables
  unwinding.
