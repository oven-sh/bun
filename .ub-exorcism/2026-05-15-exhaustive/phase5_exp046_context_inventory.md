# EXP-046 Context Inventory — WorkTask / ConcurrentPromiseTask

Run: `2026-05-15-exhaustive`  
Date: 2026-05-16  
Source branch: `claude/ub-exorcist-audit`

Purpose: close the easy part of EXP-046 without overclaiming. The generic
Miri witness proves the owned-wrapper anti-pattern, but Bun has two different
wrappers:

- `src/jsc/WorkTask.rs`: `ctx: *mut Context` (raw pointer; not a faithful owned
  payload witness)
- `src/jsc/ConcurrentPromiseTask.rs`: `ctx: Box<Context>` (owned payload; close
  to the Miri witness)

## Inventory

| Wrapper | Context impl | Source | Ownership shape | Worker-side run touches | Current verdict |
| --- | --- | --- | --- | --- | --- |
| `WorkTask<C>` | `WriteFile` | `src/runtime/webcore/blob/write_file.rs:35` | raw `*mut WriteFile` | `WriteFile::run(task)` mutates the request state and IO fields | Fails temporary `+ Send` bound; confirmed unsafe-contract defect, raw-pointer exploitability still per-context |
| `WorkTask<C>` | `ReadFile` | `src/runtime/webcore/blob/read_file.rs:156` | raw `*mut ReadFile` | `ReadFile::run(task)` performs filesystem work; `then` consumes with `heap::take` on JS thread | Fails temporary `+ Send` bound; confirmed unsafe-contract defect, raw-pointer exploitability still per-context |
| `WorkTask<C>` | `GetAddrInfoRequest` | `src/runtime/dns_jsc/dns.rs:1409` | raw `*mut GetAddrInfoRequest` | `GetAddrInfoRequest::run(this, task)` performs resolver work; `then` JS-thread | Fails temporary `+ Send` bound; confirmed unsafe-contract defect, raw-pointer exploitability still per-context |
| `ConcurrentPromiseTask<C>` | `CopyFile<'_>` | `src/runtime/webcore/blob/copy_file.rs:88` | owned `Box<CopyFile<'_>>` | `run_async()` uses file stores / refs; `then` resolves promise | Fails temporary `+ Send` bound; owned-wrapper side matches generic Miri witness class |
| `ConcurrentPromiseTask<C>` | `PipelineTask<'_>` | `src/runtime/image/Image.rs:1382` | owned `Box<PipelineTask<'_>>` | `PipelineTask::run()` operates over `RawSlice`, image pointer, pinned JS value metadata | Fails temporary `+ Send` bound; owned-wrapper side matches generic Miri witness class |
| `ConcurrentPromiseTask<C>` | `TransformTask<'_>` | `src/runtime/api/JSTranspiler.rs:704` | owned `Box<TransformTask<'_>>` | `TransformTask::run()` parses/transforms using copied `Transpiler`, `ThreadSafe<StringOrBuffer>`, macro map, tsconfig | Fails temporary `+ Send` bound; owned-wrapper side matches generic Miri witness class |
| `ConcurrentPromiseTask<C>` | `WalkTask<'_>` | `src/runtime/api/glob.rs:238` | owned `Box<WalkTask<'_>>` | `walker.walk()` and error storage; JS resolution only in `then` | Fails temporary `+ Send` bound; owned-wrapper side matches generic Miri witness class |

## Fresh-Eyes Correction

`experiments/EXP-046/src/main.rs` originally described itself too broadly as a
production `WorkTask` mirror. That was misleading. It has now been corrected:
the repro is a **generic owned-wrapper** witness. It is source-faithful for the
`ConcurrentPromiseTask<C>` risk class (`ctx: Box<C>`), and only a lower-bound
design warning for `WorkTask<C>` (`ctx: *mut C`).

## Current Classification

EXP-046 is now `CONFIRMED_UB` at the unsafe-contract boundary because the
generic owned-wrapper Miri witness is paired with a source compile experiment:
all seven real contexts fail a temporary `+ Send` bound. The next defensible
split is remediation-oriented:

- `EXP-046A`: `WorkTask<C>` raw-pointer contexts. Requires per-context run/drop
  and panic-path hardening before choosing the exact fix.
- `EXP-046B`: `ConcurrentPromiseTask<C>` owned contexts. Strongest remediation
  target because the wrapper owns `Box<C>` and the generic Miri witness directly
  models the owned-context laundering shape.

The immediate remediation is mechanically safe but not integration-trivial: add
`+ Send` to both task context traits, then let `cargo check` identify every
concrete context requiring either an explicit worker-safe wrapper or a redesign.
That deliberately turns an unsafe runtime contract into compiler-visible debt.
