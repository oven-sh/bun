# EXP-018 GuardedLock Auto-Trait Audit

Run: `2026-05-15-exhaustive`
Date: `2026-05-16`

## Verdict

`EXP-018` is a confirmed unsafe safe-API contract defect.

The proof is compile-time, source-faithful, and uses Bun's real
`bun_threading` crate:

```text
phase5_experiment_results/EXP-018-source-faithful-autotrait.log
```

`cargo +nightly check` succeeds for a program that:

1. creates a `static bun_threading::Guarded<u32>`,
2. acquires `let guard = GUARDED.lock()`,
3. moves that held guard into `std::thread::spawn(move || drop(guard))`.

`thread::spawn` requires the closure and all captured values to be
`Send + 'static`. Therefore the audited base `origin/main@4d443e5402` allows
entirely safe Rust to drop a held `GuardedLock<'static, u32, Mutex>` on a
different OS thread. W4 spot-check against latest fetched
`origin/main@e750984db6` shows the `_not_send` marker is still absent.

## Source Contract

`src/threading/Mutex.rs` documents the invariant directly:

```text
It is undefined behavior if the mutex is unlocked from a different thread
that it was locked from.
```

`GuardedLock::drop` unconditionally calls `self.guarded.mutex.unlock()`.

Sibling guard types already encode the same invariant:

- `MutexGuard` carries `_not_send: PhantomData<*const Mutex>`.
- `RwLockReadGuard` carries `_not_send: PhantomData<*const ()>`.
- `RwLockWriteGuard` carries `_not_send: PhantomData<*const ()>`.

`GuardedLock` is the outlier: it stores only `&GuardedBy<Value, M>`, and
`GuardedBy<Value, Mutex>: Sync` under `Value: Send`, so the guard auto-derives
`Send`.

## Platform Nuance

This is not a default-Miri memory-model trace. The consequence is backend
contract UB / misuse:

- Windows: `ReleaseSRWLockExclusive` is called from a non-owner thread. The
  Windows API documents this as undefined behavior; Bun's own source keeps
  that call inside an unsafe block for exactly this reason.
- Darwin: `os_unfair_lock_unlock` is documented / implemented as an abort on
  misuse. That is not silent UB, but it still proves the guard's `Send` surface
  is wrong for the backend.
- Linux/futex: the release backend has no owner tracking in release mode, but
  Bun's public `Mutex::unlock` contract still forbids non-owner unlock. The
  debug backend catches this with an owner-thread assertion.

The correct fix is the same one already used by the sibling guards and by open
PR #30765: add a `PhantomData<*const ()>` marker to `GuardedLock` and initialize
it in both constructors.
