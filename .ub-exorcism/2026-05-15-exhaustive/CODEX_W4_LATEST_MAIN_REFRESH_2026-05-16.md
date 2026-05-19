# Codex W4 Latest-Main Drift Refresh — 2026-05-16

**Run:** `2026-05-15-exhaustive`  
**Skill workflow:** W4 already-mature refresh over the existing UB registry  
**Old audited base:** `4d443e5402`  
**Latest fetched `origin/main`:** `e750984db6`  
**Branch under audit artifacts:** `claude/ub-exorcist-audit`  

This is a targeted refresh, not a full restart of the 12-phase audit. Its job is to protect the public artifacts from stale latest-main claims after upstream moved by 7 commits.

**Supersession note (Codex fresh-eyes pass):** this W4 refresh predates the
late EXP-109/110/111 normalization and follow-up corrections. The final
pinned-base registry now has **70 `CONFIRMED_UB`** entries, not 68. Keep this
document as a latest-main spot-check table for `origin/main@e750984db6`, not as
the final registry-count source of truth.

## Upstream Drift

`origin/main` is now 7 commits ahead of the audited base:

```text
e750984db6 cargo fmt
880ee8929f Clean up Zig-port phase comments and trivial lint warnings (#30877)
e520065ebb Harden 36 reachable security findings across runtime, install, parsers, http (#30722)
f7c692ae9c Fix worker teardown crash from missing dupeRef on synthetic-module specifiers (#30882)
8438ff7baa resolver: split the port's module wrapper into files; type the extern-Rust pointers (#30880)
f85020a32f hooks: deny direct rustfmt, point at cargo fmt --all (#30881)
2a3d0e7d29 resolver: keep forward slashes when imports target is a package specifier (#30845)
```

The material commit is `e520065ebb`, which changes 31 Rust files and hardens 36 reachable security findings. That commit is valuable work, but it is not equivalent to merging the UB audit's confirmed fixes.

## Checked-Live Findings On `origin/main@e750984db6`

The following probes were run with `git grep` against `origin/main`, without switching the working tree. They are direct source-presence checks for specific confirmed UB shapes.

| EXP | Latest-main status | Evidence |
|-----|--------------------|----------|
| EXP-002 | **STILL_LIVE** | `src/errno/linux_errno.rs:192` still contains `transmute::<u16, E>(int as u16)`. |
| EXP-097 | **STILL_LIVE** | `src/errno/lib.rs:301-309` and `src/errno/windows_errno.rs:246-254` still expose safe `pub const fn from_raw` bodies that transmute unchecked sparse enum discriminants. |
| EXP-018 | **STILL_LIVE** | `src/threading/guarded.rs` still constructs `GuardedLock { guarded: self }`; no `_not_send: PhantomData<*const ()>` marker appears in the guard. |
| EXP-019 | **STILL_LIVE** | `src/ast/nodes.rs:339-340` still has unbounded `unsafe impl<T> Send` / `Sync for StoreSlice<T>`. |
| EXP-003 / EXP-006 | **STILL_LIVE SHAPE** | `Package/Meta.rs` still has validity-bearing enum fields materialised from lockfile bytes via `Package::load_fields`' typed-column memcpy path. The hardening commit changed neighboring `Package.rs` validation but did not add checked decoding / byte-open newtypes for `Meta`. |
| EXP-036 | **STILL_LIVE SHAPE** | `src/install/lockfile/Buffers.rs:104` still exposes `read_array<T: Copy>`, and the `PatchedDep` bool-validity witness remains the `read_array<T>` chokepoint. This is the `LockfileArrayElem` / checked-bit-pattern fix point; it does **not** close EXP-003/006. |
| EXP-005 / EXP-034 | **STILL_LIVE SHAPE** | `src/install/yarn.rs:1400-1401` still uses `set_len` over dependency/resolution buffers; `migration.rs` remains in the changed-file intersection. |
| EXP-007 | **STILL_LIVE** | `src/install/lockfile/Tree.rs:1020` still uses `deps.get_unchecked(dep_id as usize)`. |
| EXP-008 / EXP-009 | **STILL_LIVE** | `src/semver/lib.rs:536-537` and `:613` still use packed `(off,len)` with `get_unchecked`. |
| EXP-004 | **STILL_LIVE** | `src/runtime/webcore/encoding.rs:305` still uses `Vec::from_raw_parts` for the `Vec<u8> -> Vec<u16>` reinterpret path. |
| EXP-011 | **STILL_LIVE** | `src/picohttp/lib.rs` is not touched by the drift commits; the prior NUL-write provenance finding remains source-identical unless separately proven otherwise. |
| EXP-082 | **STILL_LIVE SHAPE** | `src/jsc/webcore_types.rs:95-96` still has `unsafe impl Send` / `Sync for Blob`, and `Blob::global_this(&self) -> Option<&JSGlobalObject>` remains at `:224-230`. |
| EXP-083 | **STILL_LIVE SHAPE** | `src/runtime/shell/IOWriter.rs` and `IOReader.rs` still expose `Send`/`Sync` impls over safe `&self` state-mutating methods. |
| EXP-084 | **STILL_LIVE SHAPE** | `src/jsc/VirtualMachine.rs:602-603` still has `unsafe impl Sync` / `Send for VirtualMachine`; safe accessors still reference the single-JS-thread invariant. |
| EXP-087 | **STILL_LIVE SHAPE** | `src/bundler/ThreadPool.rs:412` still exposes `get_worker(&self, id) -> &'static mut Worker`. |
| EXP-079 | **STILL_LIVE SHAPE** | `src/bundler/transpiler.rs:260` still exposes `env_mut(&self) -> &'a mut Loader<'a>`. |
| EXP-058 | **STILL_LIVE SHAPE** | `src/bun_core/output.rs:1075` still exposes the `source_writer_escape(...) -> &'static mut io::Writer` helper. |
| EXP-106 | **STILL_LIVE SHAPE** | `src/io/PipeWriter.rs:426-451,1572-1619,2105-2185` still uses `&mut self` completion/error entry points plus `black_box(ptr::from_mut(self))` before calling parent callbacks; `src/runtime/webcore/FileSink.rs:461-526` still allows `FileSink::on_write` to re-enter `writer.with_mut`. The drift commits only changed comments/formatting in these files. |
| EXP-107 | **STILL_LIVE SHAPE** | `src/jsc/rare_data.rs:864-891` on `origin/main@e750984db6` still has `close_all_watchers_for_isolation(&mut self)` plus `black_box(ptr::from_mut(self))`, and the source comment still says close callbacks can push back onto the same watcher Vecs. |
| EXP-108 | **STILL_LIVE SHAPE** | `src/jsc/event_loop.rs:455-507` on `origin/main@e750984db6` still has `run_callback(&mut self)` / `run_callback_with_result(&mut self)` plus `black_box(ptr::from_mut(self))`, and the source comment still says JS callbacks can re-enter the same loop through `vm.event_loop()`. |

## Changed-File Intersection

A mechanical intersection between `git diff --name-only 4d443e5402..origin/main` and the then-current 59 `CONFIRMED_UB` rows found **52 confirmed rows whose cited source files changed**. This W4 pass predates later promotions through EXP-108 and then EXP-110/111 (the final pinned-base registry is now 70 `CONFIRMED_UB`). Most changed files were broad `cargo fmt`, identifier cleanup, or neighboring security hardening rather than semantic closure of the UB shape.

Important examples:

- `e520065ebb` changed `src/runtime/webcore/Blob.rs`, but the EXP-082 root is in `src/jsc/webcore_types.rs` (`Blob: Send + Sync` + `global_this(&self)`), which remains unchanged.
- `e520065ebb` changed `src/http/lib.rs`, but `src/picohttp/lib.rs` was not changed; EXP-011 remains live by source identity.
- `e520065ebb` changed install/package-manager files, but did not add either of the two lockfile validity closures: checked decoding / byte-open newtypes for `Package::load_fields` `Meta` fields (EXP-003/006), or a `LockfileArrayElem` / checked-bit-pattern constraint for `Buffers::read_array<T: Copy>` (EXP-036).
- `e750984db6 cargo fmt` shifts many line numbers; line drift is not a fix.

## Witness Replays

After the source-presence probes above, Codex replayed a high-priority subset
of standalone witnesses. These logs do not replace a full per-EXP latest-main
replay, but they strengthen the checked-live table for the most important
clusters.

| EXP | Replay artifact | Result |
|-----|-----------------|--------|
| EXP-002 | `phase5_experiment_results/W4_EXP-002_origin_main_replay.log` | Miri rejects invalid enum tag `0x0086`; `miri_exit=1`. |
| EXP-004 | `phase5_experiment_results/W4_EXP-004_origin_main_replay.log` | Miri rejects the `Vec<u8> -> Vec<u16>` shape as an unaligned `&mut [u16]`; `miri_exit=1`. |
| EXP-007 | `phase5_experiment_results/W4_EXP-007_origin_main_replay.log` | Miri rejects the unchecked dependency-index OOB path; `miri_exit=1`. |
| EXP-008 | `phase5_experiment_results/W4_EXP-008_origin_main_replay.log` | Miri rejects OOB pointer arithmetic in `SemverString::slice`; `miri_exit=1`. |
| EXP-009 | `phase5_experiment_results/W4_EXP-009_origin_main_replay.log` | Miri rejects OOB pointer arithmetic in `SemverString::eql`; `miri_exit=1`. |
| EXP-018 | `phase5_experiment_results/W4_EXP-018_origin_main_compile_witness.log` | `cargo check` succeeds, proving safe Rust can still move the held `GuardedLock` to another thread; `cargo_check_exit=0`. |
| EXP-019 | `phase5_experiment_results/W4_EXP-019_origin_main_compile_witness.log` | `cargo check` succeeds for the unbounded `StoreSlice<Cell<_>>` auto-trait witness; `cargo_check_exit=0`. |
| EXP-097 | `phase5_experiment_results/W4_EXP-097_origin_main_replay.log` | Release-mode Miri rejects invalid sparse enum tag `0x008a`; `miri_exit=1`. |

## Correct Public Wording After This Refresh

Use this:

> The UB exorcist run found 70 confirmed UB-class findings against `origin/main@4d443e5402`. This W4 refresh against `origin/main@e750984db6` predates the final two confirmations but still confirms that multiple highest-priority findings are source-live, including the errno enum transmutes, the three open PR #30765 fixes, the lockfile raw-array chokepoint, semver OOB unchecked slicing, the `Vec<u8> -> Vec<u16>` allocator-layout bug, EXP-106's `PipeWriter` / `FileSink` re-entry shape, EXP-107/108's RareData/EventLoop callback-receiver shapes, and several safe-API Send/Sync/aliasing defects. Upstream also landed an unrelated broad hardening commit fixing 36 reachable security findings; final latest-main counts still require per-EXP replay before quoting a single exact live number.

Current correction: after additional Codex promotions and the EXP-109
demotion, the pinned-base registry now has **70 confirmed UB-class entries**.
The targeted latest-main check above confirms many high-priority entries remain
source-live, but it is not a full replay of all 70. The
no-exact-latest-main-count warning still stands.

Avoid this:

> Latest Bun main still has exactly 70 confirmed UB findings.

That exact latest-main number has not been fully replayed. The defensible claim is: **the latest main still contains many of the highest-confidence UB findings, and the broad hardening commit did not close the major UB clusters checked above.**

## Next Refresh Work

1. Replay the Miri witnesses for the checked-live high-priority subset on a temporary `origin/main@e750984db6` worktree.
2. Convert this W4 table into per-EXP statuses: `STILL_LIVE`, `FIXED_BY_e520065ebb`, `STALE_LINE_ONLY`, `PARTIALLY_FIXED`, or `NEEDS_REPLAY`.
3. Only after that, replace the final report's base-pinned headline with a latest-main headline.
