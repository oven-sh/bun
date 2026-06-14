# Codex Review — Phase 1 Sections B/J/O

Reviewed against current source on `claude/ub-exorcist-audit` / `origin/main`
baseline `4d443e5402`.

## Corrections Applied

1. **Registered Section J's `EXP-026`.**
   Section J introduced `EXP-026` for the `timer::All` re-entry receiver-shape
   watchpoint, but the central experiment registry stopped at `EXP-021`.
   Added a well-formed `EXP-026` block. A later Phase-5 Tree-Borrows model
   confirmed the receiver-shape concern, so the registry now treats EXP-026 as
   `CONFIRMED_UB` **as a model witness** while still asking for an integrated
   timer/JSC trace before claiming a production crash.

2. **Broadened the `LinearFifo` EXP-001 explanation.**
   The prior wording made the issue sound limited to "niche-bearing T". That is
   too narrow. `DynamicBuffer<T>::as_slice()` / `as_mut_slice()` reinterpret the
   entire `Box<[MaybeUninit<T>]>` as `&[T]` / `&mut [T]`, including unused slots.
   Niche-bearing / validity-constrained types produce the crispest Miri traces,
   but the source pattern is exposing uninitialized backing storage as `T`.

3. **Clarified the `uv::Pipe` zero-init row.**
   `src/runtime/api/bun/spawn/stdio.rs:641-649` already explains the
   zero-initialized Windows pipe sentinel (`pipe.loop == null` means never
   initialized). The gap is that the unsafe call lacks a literal `SAFETY:` label,
   not that the file has no rationale at all. Phase 2 should verify libuv's
   Windows `uv_pipe_t` validity under all-zero pre-init storage.

4. **Clarified N-API `ThreadSafeFunction` cross-thread proof burden.**
   `napi_threadsafe_function = *mut ThreadSafeFunction` means Rust's auto-trait
   system is bypassed at the C ABI boundary. The safety proof is not "raw
   pointer crosses threads"; it is the N-API contract plus
   `ThreadSafeFunction`'s atomics / Mutex / Condvar protocol.

## Remaining Phase-2 Questions

- EXP-026 now has a Tree-Borrows minimization. The remaining work is an
  integrated timer/JSC witness or a source patch changing the receiver to a raw
  owner token.
- Instantiate `LinearFifo<RefDataValue>`, `LinearFifo<Entry>`, and
  `LinearFifo<PromisePair>` under Miri; do not rely on the old "byte buffer"
  assumption for these live Section-J callers.
- Audit `ThreadSafeFunction`'s close/finalizer/inter-thread call interleavings
  as a protocol, not just as an auto-trait question.
