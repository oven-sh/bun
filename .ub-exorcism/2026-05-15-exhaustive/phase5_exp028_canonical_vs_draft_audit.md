# EXP-028 Source Audit — Canonical `DirectoryWatchStore` vs Phase-A Draft

Date: 2026-05-16

## Verdict

EXP-028 should **not** be counted as a current production UB finding.

The TODO-marked implementation still exists at
`src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81`, and its comment is
accurate for that implementation: it returns `&mut DevServer` from
`&mut DirectoryWatchStore` via `from_field_ptr!`.

However, current `origin/main` also contains a canonical `dev_server`
implementation at `src/runtime/bake/dev_server/mod.rs`, and that is the type
used by `crate::bake::dev_server::DirectoryWatchStore`. The canonical
implementation has already applied the right shape:

- `src/runtime/bake/dev_server/mod.rs:1001-1023` defines the live
  `DirectoryWatchStore` and `owner(&mut self) -> *mut DevServer`.
- `src/runtime/bake/dev_server/mod.rs:1025-1033` creates a scoped disjoint
  sibling borrow (`dev_bun_watcher`) from the raw parent pointer.
- `src/runtime/bake/dev_server/mod.rs:1278-1284` documents the
  disjoint-field reborrow before taking `graph_safety_lock`.
- `src/runtime/bake/dev_server/mod.rs:1316-1318` explicitly preserves the raw
  pointer so the `&mut self` borrow from `owner()` does not overlap later
  `self.*` accesses.

The old file is mounted as a Phase-A draft submodule:

`src/runtime/bake/dev_server/mod.rs:33-34`

```rust
#[path = "../DevServer/DirectoryWatchStore.rs"]
pub(crate) mod directory_watch_store_body;
```

`rg` finds no call sites of
`directory_watch_store_body::DirectoryWatchStore`; the canonical type is the
one defined directly in `dev_server/mod.rs`.

## Dynamic Evidence

The existing source-shaped Tree-Borrows model also did **not** reproduce UB:

- `phase5_experiment_results/EXP-028.log`
- `phase5_experiment_results/EXP-028-rerun.log`

Those logs are clean under `-Zmiri-tree-borrows` for the parent-use-then-child
use shape that mirrors the current canonical code.

## Correct Classification

EXP-028 is now a **NO_EVIDENCE / stale-draft hygiene** item:

- Do not count it as confirmed UB.
- Do not describe it as the canonical `DirectoryWatchStore` case.
- Keep it as source-hygiene evidence that stale Phase-A draft modules can
  preserve older unsafe shapes after the live implementation has been
  rewritten.

The structural remediation (S3: prefer raw parent pointers over returning
`&mut Parent` from `from_field_ptr!`) is still good for the broader F-A-2
cluster, but it should no longer claim to close EXP-028 as a live production
bug. For `DirectoryWatchStore` specifically, the canonical code has already
implemented the S3 shape.
