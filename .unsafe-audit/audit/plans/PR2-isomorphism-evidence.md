# PR #2 — Isomorphism + Verification Evidence

This document records per-fix verification for the three changes that ship in the companion fix PR ([`claude/unsafe-exorcist-demo`](https://github.com/Dicklesworthstone/bun/tree/claude/unsafe-exorcist-demo)).

**Scope discipline.** Of the current 40 T1/T1-equivalent dashboard entries (including the 6 ceiling-score supply-chain entries), this PR lands the **3 lowest-risk fixes with focused local verification and miri-backed evidence where applicable**. The remaining fixes are deliberately staged as separate, more carefully reviewed PRs per the audit's PR-landing-order document ([`.unsafe-audit/PASS4_FINDINGS_INDEX.md` § "Pass-4 PR landing order"](../../PASS4_FINDINGS_INDEX.md)). Better three narrowly verified fixes than ten with mixed risk.

---

## Fix 1 — `bun_ast::StoreSlice<T>` Send/Sync bounded on T

**Audit ID:** `pre-existing-ub-002`
**File:** `src/ast/nodes.rs:339-345`
**Commit:** `b1a16e0b7c`

### Diff

```diff
- unsafe impl<T> Send for StoreSlice<T> {}
- unsafe impl<T> Sync for StoreSlice<T> {}
+ unsafe impl<T: Send> Send for StoreSlice<T> {}
+ unsafe impl<T: Sync> Sync for StoreSlice<T> {}
```

### Isomorphism evidence

- **Type-system change only.** Adding a where-clause bound on an `unsafe impl` does not change runtime behavior, layout, or codegen for any `T` that already satisfies the bound.
- **No existing call site breaks.** Enumeration of every `StoreSlice<T>` instantiation in `src/`:
  - `StoreSlice<Arg>`, `StoreSlice<ArrayBinding>`, `StoreSlice<Binding>`, `StoreSlice<Case>`, `StoreSlice<ClauseItem>`, `StoreSlice<EnumValue>`, `StoreSlice<Property>`, `StoreSlice<Stmt>`, `StoreSlice<StoreStr>`, `StoreSlice<TemplatePart>`.
  - All are AST POD types that are `Send + Sync` (verified by `cargo +nightly check -p bun_ast -p bun_js_parser -p bun_bundler`).
- **Sister-type symmetry.** `StoreRef<T>` (lines 39-40 of the same file) already has identical bounds with a comment that explicitly explains the laundering concern. This fix brings `StoreSlice` into parity.
- **Trybuild compile-fail fixture** (`.unsafe-audit/audit/tests/storeslice_send_compilefail.rs`) is designed to verify that `StoreSlice<Cell<u32>>: Send + Sync` compiles BEFORE the fix and fails to compile AFTER the fix with `E0277: Cell<u32> cannot be shared between threads safely`. It is evidence scaffold, not a claim that the fixture has been wired into Bun CI.

### Verification

| Check | Result |
|-------|--------|
| `cargo +nightly check -p bun_ast` | ✓ clean |
| `cargo +nightly check -p bun_ast -p bun_js_parser -p bun_bundler` (downstream) | ✓ clean (16.5s) |
| `cargo +nightly miri test -p bun_ast --lib` | ✓ 5/5 pass under `-Zmiri-strict-provenance` (regression coverage, not the StoreSlice bug witness) |
| Sibling-type symmetry with `StoreRef<T>` | ✓ matches lines 39-40 verbatim modulo type name |
| Trybuild compile-fail fixture | ✓ designed; landed in audit/tests/ for optional trybuild wiring |

---

## Fix 2 — `bun_errno::impl GetErrno for usize` checked path

**Audit ID:** `pre-existing-ub-001`
**File:** `src/errno/linux_errno.rs:181-201`
**Commit:** `e154d5f1e8`

### Diff (semantic)

The unsafe `transmute<u16, E>(int as u16)` is replaced with the checked `SystemErrno::init(int as i64).unwrap_or(SystemErrno::SUCCESS)`. `SystemErrno::init` already exists at `src/errno/lib.rs:322` and is the path the sibling function `e_from_negated` (lib.rs:289) already uses for the same task.

### Isomorphism evidence

For every input value `int ∈ [0, 4096)`:

| `int` | Old behavior (transmute) | New behavior (init) | Classification |
|-------|--------------------------|---------------------|----------------|
| `0` (SUCCESS) | `SystemErrno::SUCCESS` | `SystemErrno::SUCCESS` | Equivalent |
| `1..=133` (dense kernel range) | `SystemErrno::EPERM..ENOTRECOVERABLE` | Same — `init` returns `Some(variant)` matching the transmute | Equivalent for valid discriminants |
| `134..=4095` (sparse / future kernel) | **Undefined behavior** (niche violation) | `SystemErrno::SUCCESS` (documented fallback) | Intentional semantic repair: previously UB, now defined fallback |

The new path is **strictly safer** for the same set of valid inputs and **defined** for the previously-UB-producing inputs. This patch does not rely on a disassembly/codegen claim; the conversion runs only on the syscall-error decoding path, and the soundness improvement is the reason for the change.

**Mirroring policy.** The `unwrap_or(SystemErrno::SUCCESS)` fallback matches the existing policy in `e_from_negated` (lib.rs:289) for the same enum. No new policy is introduced — only consistency.

### Verification

| Check | Result |
|-------|--------|
| `cargo +nightly check -p bun_errno` | ✓ clean |
| `cargo +nightly miri test -p bun_errno --lib` | ✓ 3/3 pass under `-Zmiri-strict-provenance` |
| Miri-confirmed pre-fix UB | ✓ documented in [`miri-confirmed-linux-errno-transmute.md`](../../verification/miri-confirmed-linux-errno-transmute.md) |
| Codegen equivalence (valid inputs) | Not asserted; focused cargo + miri verification covers correctness, and the path is cold/error-handling |
| Policy consistency with `e_from_negated` | ✓ same fallback, same trait |

---

## Fix 3 — `bun_threading::GuardedLock` marked `!Send` / `!Sync`

**Audit ID:** `TH-1`
**File:** `src/threading/guarded.rs:138-145`
**Commit:** `3c1323386c`

### Diff (semantic)

`GuardedLock<'a, Value, M>` could auto-derive `Send` whenever `GuardedBy<Value, M>: Sync` (this module explicitly re-asserts `Sync` under `Value: Send, M: RawMutex + Sync`) because its only field was `guarded: &'a GuardedBy<...>`. Add `_not_send: PhantomData<*const ()>` to make it `!Send + !Sync`, mirroring sibling `MutexGuard` (Mutex.rs:114-120) which has the same marker with the same rationale.

### Isomorphism evidence

- **Layout.** `PhantomData<*const ()>` is a ZST. `size_of::<GuardedLock>()` is unchanged. `align_of::<GuardedLock>()` is unchanged.
- **Codegen.** `PhantomData` is purely a type-level marker. No runtime instructions emitted. Drop is unchanged (the field has no Drop glue).
- **Behavior.** `GuardedLock: !Send + !Sync` after this change. Behavior for all existing call sites (which drop the guard on the locking thread) is identical to before.
- **Sister-type symmetry.** `MutexGuard` at `src/threading/Mutex.rs:114-120` has the same `PhantomData<*const Mutex>` marker with a comment that explains: "the Darwin `os_unfair_lock` / Windows `SRWLOCK` backends require unlock on the locking thread." This fix brings `GuardedLock` into parity.

### Verification

| Check | Result |
|-------|--------|
| `cargo +nightly check -p bun_threading` | ✓ clean |
| `cargo +nightly check -p bun_ast -p bun_install -p bun_threading` (downstream consumers) | ✓ clean |
| `cargo +nightly miri test -p bun_threading --lib` | ✓ 2/2 pass under `-Zmiri-strict-provenance` (regression coverage, not a pre-fix bug witness) |
| Two construction sites updated (`try_lock` line 74, `lock` line 103) | ✓ both add `_not_send: PhantomData` |
| Sister-type symmetry with `MutexGuard` | ✓ same marker, same explanatory comment shape |

---

## Aggregate verification

| Crate | `cargo check` | miri tests (strict provenance) |
|-------|:---:|:---:|
| `bun_ast` | ✓ | 5/5 |
| `bun_errno` | ✓ | 3/3 |
| `bun_threading` | ✓ | 2/2 |
| Downstream (`bun_install`, `bun_bundler`, `bun_js_parser`) | ✓ | n/a (separately tested) |

**Aggregate: 10/10 miri tests pass clean under `-Zmiri-strict-provenance` across all touched crates.**

---

## What is NOT in this PR

The audit's current public dashboard catalogs 40 T1/T1-equivalent entries, including 6 ceiling-score supply-chain entries, with strict memory-safety and explicitly-labelled non-UB security items separated. Critical crash-reliability items are tracked outside that T1 risk table. This PR lands 3 tightly verified fixes. The remaining fixes are deliberately staged as separate PRs:

| Cluster | Audit ID(s) | Reason for separate PR |
|---------|-------------|------------------------|
| Lockfile niche-transmute supply-chain | PUB-INSTALL-1, -2, -3, -4 | Lockfile deserialization is high-blast-radius; needs error-type extension (SubtreeError variant) + multi-step validation refactor |
| `bun_semver` packed-string OOB | F-NEW-1, F-NEW-2 | Touches every `Dependency::*` field; needs bounded-string validation pass |
| picohttp NUL-write through shared | H9 | Requires owning-mutable-buffer refactor through the HTTP read path |
| Bundler parallel-callback aliasing | bundler-B1..B5 | 5 sites all share the `&mut LinkerContext` shape; needs the `doStep5.rs:43-58` `*mut` template applied systematically |
| 8 dealloc-through-`SharedReadOnly` | U2.×8 | Each site needs to retain the owning `*mut T` from `into_raw` |
| `fmt::Raw` UTF-8 violation | P3-BC-001 | Behavior change for non-UTF-8 argv/tarball paths; needs UX decision |
| `crash_handler` mutex in signal handler | CRASH-T1-1, CRASH-T1-2 | Signal-handler code is delicate; needs `AtomicBool` + avoid-RefCell rewrite |
| Async cancellation re-entry (Pass-5 finds) | h2-cancel-1..4, websocket-cancel | Each h2 callback needs `ThisPtr` pattern application |

Each of these is documented with file:line citations and proposed fix shape in the per-cluster plans under [`.unsafe-audit/audit/plans/`](../).

The maintainers can land them in any order they prefer.
