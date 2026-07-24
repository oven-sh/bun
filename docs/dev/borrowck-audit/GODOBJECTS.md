# God-object refactor investigation

For each of the five structs with the highest borrowck-fight density (see `FOLLOWUPS.md` §3), this investigation read the struct definition, the conflicting-access sites from the audit, and the FFI/provenance constraints, then proposed (or rejected) a structural refactor.

Full per-struct detail (conflict groups, pseudocode, churn counts, FFI constraints) is in [`godobject-designs.json`](godobject-designs.json).

## Verdicts

| struct | fields | borrowck sites | recommendation | sites eliminated | churn | risk |
|---|---:|---:|---|---:|---|---|
| `PackageManager` | 69 | 63 | **do it** | ~28 | 26 methods, ~210 call sites, 22 files | medium |
| `Printer` (js_printer) | 23 | 9 | **do it** | 6 | 2 methods, 6 call sites, 2 files | low |
| `BundleV2` | 23 | 20 | per-method only | ~5 | 7 methods, ~120 call sites, 18 files | medium |
| `VirtualMachine` | 100 | 15 | per-method only | 3 | 10 methods, 15 call sites, 12 files | low |
| `H2FrameParser` | 60 | 6 | not worth it | 0 | n/a | n/a |

## PackageManager: extract `TaskScheduler` sub-struct

**Why**: 23 of the 63 sites are the same shape: a `&[u8]` slice derived from `lockfile.str(...)` (or `&options.*`) held while a `&mut PackageManager` method mutates task/network/manifest state. None of those mutators touch `lockfile` or `options`. Rust's per-field disjoint-borrow rule fixes this automatically once the task state lives in a nested struct.

**Design** (full pseudocode in [`godobject-designs.json`](godobject-designs.json)):

1. Move 22 task-scheduling fields (`task_batch`, `task_queue`, `network_*`, `patch_*`, `preallocated_*`, `pending_tasks`, `manifests`, `folders`, `git_repositories`, `preinstall_state`, `thread_pool`) into `pub struct TaskScheduler`. `PackageManager` gains `pub sched: TaskScheduler`.
2. Hot enqueue fns get a split form `fn enqueue_x_split(sched: &mut TaskScheduler, lockfile: &Lockfile, options: &Options, log: &mut Log, ...)`; the `&mut self` wrapper stays for non-conflicting callers.
3. Make `get_cache_directory` / `manifest_disk_cache_ctx` / `root_package_id` take `&self` by storing the lazy-init state in `OnceCell` / `Cell`. This lets `is_root_dependency` drop its `&mut PackageManager` param.

**FFI constraint**: `PackageManager` is a leaked process-singleton at a stable address (`static holder::RAW_PTR`) and two callback paths pass `*mut PackageManager` as `*mut c_void` (wake-handler, `event_loop.tick_once`). Nesting fields does NOT change the outer address, so both paths keep working. Splitting into two top-level singletons would break them.

**Not changed**: `event_loop` tick (intrinsic self-as-context callback, correct as-is), `progress` node tree (self-referential by design), `PackageInstaller` sites (separate struct, already idiomatic or covered by C1 handoff).

## Printer: relax `name_for_symbol` + `MiView` helper

**Why**: 5 of 9 sites re-borrow `self.module_info` per loop iteration because `name_for_symbol(&mut self)` takes `&mut` despite being read-only in every `Renamer` variant. 1 more site wraps a `Copy` option field in `BackRef`. The remaining 3 hold `&Symbol` across print calls and are structurally unfixable without rewriting ~162 print methods.

**Design**:

1. Change `MinifyRenamer::name_for_symbol` and `Renamer::name_for_symbol` to `&self` (body is already read-only). All 8 external callers keep compiling.
2. Add `Printer::mi_view(&mut self) -> Option<MiView<'_, 'a>>` that disjoint-borrows `{&mut module_info, &renamer, bump}` once per block instead of per-iteration.
3. Site 3069: `options.commonjs_named_exports` is `Option<&'a _>` (Copy); copy to a local, drop `BackRef`.
4. Sites 3942/5288/5359: centralize into one `fn symbol_ref(&self, r: Ref) -> Option<BackRef<'a, Symbol>>` accessor with one `// SAFETY:` comment (symbol table never resizes during printing).

**FFI constraint**: none. `Printer` is stack-local, never held by C++, never crosses threads.

**Cost**: 2 methods change signature, 6 call sites, 2 files. Lowest-churn win on the board.

## BundleV2: per-method only (C2 handoff sufficient)

**Why not structural**: three fields are `container_of` targets (`graph`, `linker`, `drain_defer_task` recovered via `from_field_ptr!`) and must stay direct fields at stable offsets. `ParentRef<BundleV2<'static>>` / `*mut BundleV2` is held by thread-pool workers, plugin dispatch, and the hot-reloader watcher. The only field group that's both conflict-relevant and not pinned is the four transpiler fields.

**What's worth doing**: group `{transpiler, client_transpiler, owned_client_transpiler, ssr_transpiler}` into `TranspilerSet` so `for_target()` borrows only `&mut self.transpilers`. Inline `path_to_source_index_map` at the 3 conflict sites. Move `drain_deferred_tasks` onto `BundleV2`. Make `log_for_resolution_failures` an associated fn. Eliminates ~5 sites; the rest are either FFI-provenance-required or already-idiomatic SoA `split_mut()` snapshots.

The C2 handoff already covers the per-method splits; `TranspilerSet` is an optional add-on.

## VirtualMachine: per-method only (C4 handoff sufficient)

**Why not structural**: C++ `ZigGlobalObject` holds it as opaque `void* m_bunVM`; ~38 `extern "C"` thunks take `*mut VirtualMachine`; `event_loop` is a self-pointer into sibling value fields. 100 fields. Not splittable.

**What's worth doing**: the only real conflict is `rare_data()` (`&mut self`) vs `&VirtualMachine` in the same call. The RareData socket-group methods take `&VirtualMachine` but use nothing except `vm.uws_loop()` (a Copy `*mut uws::Loop`). Change their signatures to take `loop_: *mut uws::Loop` directly; `close_all_socket_groups` drops both receivers (its `&mut self` is unused). Eliminates the 3 fixable sites. The `auto_tick` / `load_preloads` sites re-enter JS and are correctly raw-ptr (`keep`).

## H2FrameParser: not worth it

**Why**: the struct is already fully interior-mutable (every field is `Cell`/`JsCell`/`RefCell`, every method takes `&self`). There are no `&mut self` field conflicts. All 6 sites are JS-reentrancy hazards: holding a `&mut Stream` across a dispatch that runs JS which may re-enter and mutate `self.streams`. No static borrow design fixes that; the runtime `dispatch_depth` guard + deferred-free is the designed invariant.

**Also**: the five handlers and the window-update collect are in the legacy decode path being replaced by `src/runtime/api/bun/h2/connection.rs` (per comment at `h2_frame_parser.rs:1309-1312`).

**What's worth doing**: replace the open-coded `unsafe { &mut *stream_ptr }` in the 5 handlers with the existing `enter_stream_dispatch()` helper. Swap `Vec` → `SmallVec<[_; 8]>` at line 2288 (already in bucket B2). That's it.

## Next steps

Two structural refactors are worth handing off as dedicated PRs:

1. **`PackageManager` → `TaskScheduler` extraction** (supersedes ~half of the C1 handoff's scope; C1 can rebase over it)
2. **`Printer` accessor relaxation + `MiView`** (supersedes the C3 handoff's scope; trivially small)

The other three stay with their existing per-method handoffs (C2, C4, bucket A2/B2 for H2FrameParser).
