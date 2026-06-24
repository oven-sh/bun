# Codex Safe-Boundary Review: EXP-047 `RacyCell` / `ThreadCell`

## Verdict

EXP-047 should **not** be counted as confirmed Bun UB.

The old Miri witness is a real `Cell<u32>` data race, but the witness performs the actual read/write by dereferencing `RacyCell::get()` inside caller-side `unsafe` blocks. That proves misuse is possible if the unsafe contract is violated. It does not prove an unsound safe API in Bun.

## Direct Bun-Crate Boundary Check

Artifacts:

- `experiments/EXP-047-safe-boundary-bun-core/Cargo.toml`
- `experiments/EXP-047-safe-boundary-bun-core/src/bin/safe_share_compiles.rs`
- `experiments/EXP-047-safe-boundary-bun-core/src/bin/raw_pointer_send_fails.rs`
- `phase5_experiment_results/EXP-047-safe-boundary-bun-core.log`

Results:

- `cargo check --bin safe_share_compiles` passes. Safe code can share `&'static RacyCell<Cell<u32>>` / `&'static ThreadCell<Cell<u32>>` and call `.get()` / `.get_unchecked()`, but that only creates an inert raw pointer.
- `cargo check --bin raw_pointer_send_fails` fails with `E0277`: `*mut Cell<u32>` cannot be sent between threads safely.
- Safe Rust still cannot dereference the raw pointer or call `Cell::set` through it.

## Production Payload Audit

Current main has only two real `ThreadCell` statics:

- `src/io/lib.rs:674` — `ThreadCell<MaybeUninit<IoRequestLoop>>`
- `src/http/lib.rs:727` — `ThreadCell<MaybeUninit<HTTPThread>>`

The cross-thread access paths are narrow and documented:

- `IoRequestLoop::schedule` uses `LOOP.get_unchecked()` but only touches `pending` (`UnboundedQueue`, atomic MPSC) and `waker`; the owner thread calls `tick()` via `LOOP.get()` and keeps mutable state behind owner-thread `Cell`s.
- `HTTPThread::schedule` uses `HTTP_THREAD.get_unchecked()` but only touches `queued_tasks` (`UnboundedQueue`) and `wakeup()` (`has_awoken` Acquire + raw uSockets wakeup pointer). Other `HTTPThread` methods are documented HTTP-thread-only.

This discipline is fragile and deserves hardening, but it is not a confirmed production race.

## Artifact Changes

- `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md`: EXP-047 verdict changed from `CONFIRMED_UB` to `NO_EVIDENCE`, with prose explaining that this is no evidence for the Bun project-UB claim.
- Confirmed-count headline drops from 60 to 59.
- `NO_EVIDENCE` rises from 15 to 16.
- Convergence rounds 103 and 104 record the corrected totals.

## Recommended Wording

Use:

> `RacyCell<T>` / `ThreadCell<T>` are auditor-fragile unsafe wrappers. Their unconditional `Sync` impls make misuse easy, and the standalone Miri witness demonstrates what happens if a caller violates the raw-pointer access contract. Current source review did not find a safe-API UB path or a concrete in-tree data race, so this remains hardening, not a counted confirmed UB.

Avoid:

> EXP-047 proves a generic safe-contract UB in `RacyCell<T>` / `ThreadCell<T>`.
