# Codex Pass 4 Corrections

This file records corrections that must be preserved when the Pass 4 markdown
artifacts are regenerated or restored.

## No Calendar-Based Remediation Schedule

Remove any calendar-based remediation projections from the audit artifacts. The
audit should present an immediate execution queue:

1. Batch 1: PUB-INSTALL-1..4, F-NEW-1/F-NEW-2, H9.
2. Batch 2: StoreSlice, PUB-INSTALL-5/6, H5, FFI closeCallback, fmt::Raw,
   Unaligned cast, TH-1.
3. Batch 3: Bundler B-1..B-5, PUB-INSTALL-7, pre-existing-ub-9,
   P3-BC-002..005.
4. Batch 4: U2.x8, UB-RT-001, F-1, writer overflow, sourcemap, U1, and the
   cfg-gated sys/errno/windows tail.

The report should not imply that known T1/T1-equivalent findings are expected
to remain open into a future release window. Any item not fixed in the same-day
run needs an explicit technical blocker, not a calendar excuse.

## Pass 4 Tier Corrections

- F-NEW-1 and F-NEW-2 are real P0 supply-chain findings and must be included in
  the risk table.
- TH-1 is a real safe-API bug: `GuardedLock` needs a non-Send marker matching
  `MutexGuard`.
- crash-handler `PANIC_MUTEX.lock()` and `Output::flush()` are critical
  signal-safety defects. They are real problems, but they are not Rust
  memory-safety T1 entries and must not inflate the T1 risk table.
- `StoreSlice<T>` remains a pre-existing T1 already counted from Pass 2. The
  dyn-trait/cross-crate Pass 4 review should not demote it to T2.
- H5 is a security P0 / request-smuggling issue, not Rust memory-UB. Keep the
  label precise.

## Pass 4 Evidence Corrections

- The risk table must be recalculated after adding F-NEW-1/F-NEW-2 and TH-1.
- The miri summary must not claim every trace has a sibling detail file unless
  the yarn/PUB-INSTALL-3 detail file exists.
- StoreSlice is a compile-time auto-trait witness, not a miri runtime trace.
