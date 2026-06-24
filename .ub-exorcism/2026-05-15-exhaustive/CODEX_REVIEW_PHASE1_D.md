# Codex Review — Phase 1 Section D (`runtime-node-compat`)

## Verdict

Section D was mostly careful, but it had one important conceptual error that would have under-reported a real Windows-only API-soundness problem.

## Correction Applied

The original Section D prose said `IteratorResultWName { data: RawSlice<u16> }` was `!Send` because it contains a raw pointer. That is false for Bun's `RawSlice<T>`:

- `src/bun_core/lib.rs:208-212` explicitly implements `unsafe impl<T: Sync> Send` and `unsafe impl<T: Sync> Sync` for `RawSlice<T>`.
- Since `u16: Sync`, `RawSlice<u16>` is `Send + Sync`.
- `IteratorResultWName` therefore does not get protected by auto-trait inference.

Current source shape:

- `src/runtime/node/dir_iterator.rs:44-67` defines `IteratorResultWName` and `IteratorResultW`.
- `src/runtime/node/dir_iterator.rs:499-522` returns `IteratorResultWName { data: RawSlice::new(&name_data[..len]) }`, where `name_data` is the iterator's scratch buffer.
- `src/runtime/node/dir_iterator.rs:564-565` documents that referenced file-name memory is invalidated by the next `next()` call or iterator deinit.
- `IteratorResultWName::slice()` is safe and returns `&[u16]`.

That combination is a safe-API contract defect: a safe caller can retain or send the owned result after iterator drop/advance, then call safe `slice()` and create a dangling shared slice.

## Experiment Added

Added `EXP-027`:

- `experiments/EXP-027/src/main.rs`
- `phase5_experiment_results/EXP-027.log`

The reproducer mirrors the current source shape and includes a compile-time `assert_send_sync::<IteratorResultW>()`. Miri then reports:

```text
Undefined Behavior: pointer not dereferenceable: alloc109 has been freed, so this pointer is dangling
```

This is a mirror witness, not a claim that the Windows path was executed on Linux. It proves the type/API shape is unsound.

## Documents Updated

- `UNDEFINED_BEHAVIOR_EXPERIMENT_DESIGNS.md` — new EXP-027.
- `phase1_inventory_D.md` — removed the false `!Send` claim and reclassified Windows as lifetime-erased/sendable.
- `phase1_notes/D_runtime_node.md` — changed "Section D is safer" to "Section D POSIX is safer; Windows needs separate remediation."
- `phase1_unsafe_surface_inventory.md` — aggregate summary now distinguishes POSIX owned results from Windows `RawSlice<u16>`.

## Current Assessment

The POSIX Section D parser is still a good remediation template for Section P because it returns owned `PathString` values. The Windows branch should not be used as proof that Section D fully solves the dirent lifetime problem. It needs a fix such as:

- return owned UTF-16/UTF-8 storage,
- carry a real lifetime tied to `&mut self`,
- make the reborrow method unsafe and document the streaming contract, and at minimum
- make the result `!Send + !Sync` if the scratch-buffer borrowing shape remains.

Current `node_fs.rs` consumers appear disciplined and copy/transcode immediately. That limits live reachability, but it does not make the Rust API sound.
