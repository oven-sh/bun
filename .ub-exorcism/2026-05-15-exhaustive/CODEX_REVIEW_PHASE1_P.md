# Codex Review — Phase 1 Section P

Run: `2026-05-15-exhaustive`

Scope reviewed:
- `phase1_inventory_P.md`
- Current source under `src/sys`, `src/io`, `src/event_loop`, `src/threading`,
  `src/spawn`, `src/spawn_sys`, `src/errno`
- Registry entry `EXP-002`

## Corrections applied

1. **GuardedLock wording tightened.**
   The finding is real: `GuardedLock` still lacks the `_not_send` marker proposed
   in open PR #30765, so a live guard can auto-derive `Send`. I changed the
   wording from a macOS/Windows-only backend claim to the stronger API claim:
   moving the guard violates `Mutex::unlock`'s documented same-thread contract.
   Backend behavior differs, but the type-level fix is unambiguously `!Send`.

2. **Re-added the missed volatile-publication finding as EXP-017.**
   Section P initially omitted prior-audit `pre-existing-ub-ptr-3`.
   Current `src/io/lib.rs:1153-1168` still uses `write_volatile` + `SeqCst`
   fence to publish a function pointer. Rust volatile is not atomic; if a plain
   read on the IO thread can overlap the store, this is data-race UB. I added a
   dedicated registry entry (`EXP-017`) and a Section P callout with the exact
   read sites to audit (`src/io/lib.rs:870` and `:1020`).

## Source checks run

- Re-read `src/errno/linux_errno.rs:181-193`: EXP-002 source shape still
  matches the prior witness (`transmute::<u16, E>(int as u16)`).
- Re-read `src/errno/lib.rs:294-333`: adjacent checked path exists through
  `SystemErrno::init`.
- Re-read `src/threading/guarded.rs:72-103` and `:132-134`: constructors return
  `GuardedLock { guarded: self }` with no non-Send marker.
- Re-read `MutexGuard` / `RwLock*Guard` marker fields; the sibling patterns
  still carry `_not_send`.
- Re-read `src/sys/lib.rs` dirent `Name`: the lifetime-erased API is a real
  safe-abstraction risk. The section's framing is directionally correct.
- Re-read `src/io/lib.rs:1153-1168`, `:870`, `:1020`: volatile publication is
  still present and not represented elsewhere in the UB registry before this
  patch.

## Remaining review risk

EXP-017 needs a source graph before promotion. The current artifact should say
"OPEN / likely if post-share mutation exists," not "confirmed data race" yet.
