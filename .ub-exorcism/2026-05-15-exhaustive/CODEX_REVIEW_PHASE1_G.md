# Codex Review — Phase 1 Section G (`runtime-bake-dev-server`)

## Verdict

Section G was directionally useful, but its EXP-028 emphasis is now superseded by a later source audit. The TODO-marked `DirectoryWatchStore::owner(&mut self) -> &mut DevServer` remains in `src/runtime/bake/DevServer/DirectoryWatchStore.rs`, but that file is mounted as a Phase-A draft module; the canonical `crate::bake::dev_server::DirectoryWatchStore` in `src/runtime/bake/dev_server/mod.rs` already returns `*mut DevServer`.

## Corrections Applied

- Added explicit cross-references from the Section G docs to `EXP-028`.
- Kept the claim scoped: the issue is a Phase-2 Miri target / likely aliasing violation, not yet a Miri-confirmed production trace.
- Fixed registry hygiene by renumbering the late-added Section G experiment from `EXP-022` to `EXP-028` so the registry remains monotonically ordered after EXP-027.
- Superseding correction (2026-05-16): demoted EXP-028 to `NO_EVIDENCE / stale-draft hygiene` after confirming the canonical implementation already uses raw parent recovery and no call sites of `directory_watch_store_body::DirectoryWatchStore` exist.

## Source Checks

- `src/runtime/bake/DevServer/DirectoryWatchStore.rs:69-81` returns `&mut DevServer` from `&mut DirectoryWatchStore` via `bun_core::from_field_ptr!`, and the source comment at `:71-73` says that shape is unsound under Stacked Borrows.
- Current canonical `src/runtime/bake/dev_server/mod.rs:1001-1023` defines the live `DirectoryWatchStore` type and returns `*mut DevServer`; later call sites scope disjoint-field reborrows.
- `rg` found no call sites of `directory_watch_store_body::DirectoryWatchStore`.
- `bake_body.rs:107-116` and `:279-298` lifetime erasure is accurately described as Phase-B type debt, not immediate confirmed UB under current internal discipline.

## Remaining Risk

`Drop for DevServer` and the Windows watcher hand-off remain worthy Phase-2 experiments, but the current artifacts are right to leave them as open questions until a witness exists.
