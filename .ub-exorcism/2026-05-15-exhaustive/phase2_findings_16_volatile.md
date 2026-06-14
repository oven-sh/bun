# Phase 2 Findings — Bucket 16: Volatile Read/Write Contracts

**Run:** 2026-05-15-exhaustive
**Bucket:** 16 (Volatile read/write contracts — alignment, validity, aliasing, atomicity confusion)
**Scope:** All `core::ptr::{read,write}_volatile` sites in `src/**/*.rs`

## Enumeration

```
$ rg -n 'read_volatile|write_volatile' --type rust src/
src/io/lib.rs:1167                              core::ptr::write_volatile(&raw mut self.callback, cb)
src/sql_jsc/postgres/PostgresSQLConnection.rs:1519   core::ptr::write_volatile(b, 0)
```

**Total volatile sites:** 2 (both writes; zero `read_volatile`).

## Per-site Verdicts

### Site 1 — `src/io/lib.rs:1167` (`Request::store_callback_seq_cst`)
- **Pointer:** `&raw mut self.callback` where `self: &mut Request`.
- **Field type:** `for<'a> fn(&'a mut Request) -> Action<'a>` — a non-nullable function pointer, pointer-sized, naturally `align_of::<fn()>()`-aligned because it is a struct field of a directly-borrowed `&mut Request`. `Request` has no `#[repr(packed)]`. Alignment ✅.
- **Validity:** target is initialized (`Request::new` sets `callback`); written value is a same-typed `fn` pointer. Validity ✅.
- **Aliasing / atomicity:** caller holds `&mut self`; the io-thread reader at lines 870 / 1020 reads `request.callback` only after popping the MPSC queue. A release/acquire queue edge can order a store performed *before* scheduling, but the three current callers (`Blob.rs:7086`, `read_file.rs:470`, `write_file.rs:265`) all write the callback before checking `if !io_request.scheduled`. If `scheduled == true`, the request may already be visible to the io thread. The publication shape is therefore **not proven race-free** by the fence comment alone. The path is **EXP-017**.
- **"Volatile ≠ atomic" trap:** the doc-comment says "Rust has no `AtomicFnPtr`, so we lower to a volatile write followed by a full fence". That is not an atomic store. The fence orders surrounding operations, but it does not make the write itself atomic and it does not protect against a concurrent plain load. EXP-017 already has a Miri model proving that primitive race; the remaining question is production overlap.
- **Verdict:** **DEFER — covered by EXP-017.** No new experiment from Bucket 16.

### Site 2 — `src/sql_jsc/postgres/PostgresSQLConnection.rs:1519` (`Connection::deinit` options-buffer scrub)
- **Pointer:** `b: &mut u8` reborrowed from `buf.iter_mut()` over `buf: &mut [u8]` (where `buf` is the in-place `Box<[u8]>` named `options_buf` at field path `(*this).options_buf`).
- **Field type:** `Box<[u8]>` — heap-allocated `u8` slice; `u8` alignment ✅; every byte valid for `0u8` ✅.
- **Aliasing:** sole-owner teardown path. `deinit` is only reachable from `deref()` when refcount reaches 0; the surrounding `unsafe { ... }` block reborrows `*this` exclusively, and the Box is dropped at end-of-scope. No concurrent readers possible. ✅.
- **Atomicity:** not used as a cross-thread publication — purpose is "best-effort credential scrub before free", same as Zig's `freeSensitive`. Single-threaded write. ✅.
- **Verdict:** **N/A — single-threaded sensitive-data zeroize; alignment + validity + aliasing all sound.** No experiment.

## Cross-bucket notes

- Neither site is MMIO; Bun has no memory-mapped device I/O in Rust.
- The only mixed volatile/plain pattern is site 1: writer uses `write_volatile`, reader uses a plain field load `(request.callback)(...)`. That is exactly the asymmetric pattern EXP-017 is meant to evaluate and the only Bucket-16 hazard worth pursuing.
- No `read_volatile` sites at all — the only consumers of these fields use ordinary loads paired with external acquire (MPSC pop, `deinit` exclusive access).

## Registry impact

- EXP-017: **superseded by Phase 5 source-overlap audit**. Bucket 16 correctly
  identified the volatile/non-atomic primitive, and the Miri primitive race model
  remains real. The later source-overlap audit found no current Bun path that
  rewrites `callback` after queue publication, so the current registry verdict is
  `NO_EVIDENCE` for production UB and the model is retained as a regression
  guard.
- No new experiments created from Bucket 16.

## Summary

- **Total volatile sites:** 2
- **DEFER → EXP-017:** 1 (io::Request::store_callback_seq_cst)
- **N/A (sound):** 1 (PostgresSQLConnection options_buf scrub)
- **New experiments:** 0
