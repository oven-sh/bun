# Codex Review — Phase 1 Section L

Date: 2026-05-15
Branch: `claude/ub-exorcist-audit`
Base: `origin/main` `4d443e5402`

Section L is high value, but it contained several conceptual overclaims that
needed correction before the audit can be considered defensible.

## What Holds

- `HasInstallScript` is still a closed `#[repr(u8)]` enum in
  `src/install/lockfile/Package/Meta.rs:39-46`.
- `Origin` is still a closed `#[repr(u8)]` enum in `src/install/lib.rs:1128-1135`.
- `Package::load_fields` still copies lockfile bytes directly into the `Meta`
  column and immediately materializes `&mut [Meta]` at
  `src/install/lockfile/Package.rs:3466-3478`.
- `src/install/yarn.rs:918-925` still creates `&mut [Dependency]` over
  allocated-but-uninitialized Vec capacity.
- `src/install/lockfile/Tree.rs:1014-1020` still performs
  `deps.get_unchecked(dep_id as usize)` where `dep_id` comes from serialized
  dependency-id data.

These are real findings and should remain prominent.

## Corrections Applied

1. **`Buffers::read_array<T>` is not the structural fix point for all PUB-INSTALL findings.**
   It does not load the `Meta` column, does not create the yarn uninitialized
   slice, and does not bounds-check Tree dependency IDs. The registry now points
   EXP-003/006 at `Package::load_fields`, EXP-005 at the yarn/migration slice
   pattern, and EXP-007 at local bounds validation.

2. **`resolver_hooks::ResolutionTag` is not currently a direct lockfile enum-from-disk UB.**
   Current `Package::resolution` uses `install::resolution::Tag`, a transparent
   `u8` newtype with `_` handling. `resolver_hooks::ResolutionTag` is a closed
   bridge enum reached through explicit match conversion in `auto_installer.rs`.
   Direct disk reachability is unproven.

3. **`dependency::External` is `[u8; N]`, not a direct enum-validity read.**
   `read_array::<dependency::External>` views disk bytes as byte arrays. The
   later `Version::to_version` path decodes the tag byte with an explicit
   match and panics on unknown values. That is not the same bug as
   `HasInstallScript`/`Origin` enum-from-disk.

4. **The strongest current `Buffers::read_array<T>` validity witness is `PatchedDep`.**
   `PatchedDep` contains a Rust `bool` read from disk bytes via
   `Vec<PatchedDep> = buffers::read_array(stream)?`; arbitrary bytes outside
   `{0,1}` violate `bool` validity. That deserves a new experiment, but it is
   a separate finding from EXP-003/005/006/007.

5. **`Tree.rs get_unchecked` should not be called confirmed without a standalone witness.**
   Current-source shape is strong, but the registry correctly keeps EXP-007 at
   `NEEDS_REFINEMENT` until Phase 5 supplies the concrete OOB witness.

## Remaining Watchpoints

- Section L's total count (`583`) is close to an independent non-comment
  `unsafe` scan (`580`) but is still a mapper-local count. Treat it as Phase-1
  workload telemetry, not a final exact headline.
- The `set_len` partial-initialization rows should be hand-traced. Some
  previous wording implied `Drop` would read partially initialized
  `Package`s, but `MultiArrayList::Drop` frees only the slab; the risk is more
  precise than that and should be proven path by path.
