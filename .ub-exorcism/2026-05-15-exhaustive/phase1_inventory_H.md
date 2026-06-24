# Phase 1 Inventory — Section H: runtime-shell

Run: `2026-05-15-exhaustive`. Scope: `src/runtime/shell/`. Tool ritual exit codes: 0/0/0.

## Mapper tallies (audited base `origin/main@4d443e5402`)

| crate region            | files (with `unsafe`) | `unsafe (fn\|impl\|trait\|extern\|{)` keyword sites | prior-audit sites |
|-------------------------|-----------------------|----------------------------------------------------|-------------------|
| `bun_runtime::shell`    | 26                    | **293**                                            | **277**           |

Delta `+16` (~+5.8 %) vs prior. Drivers: (1) the post-port `ShellSubprocess`
spawn/teardown rewrite (`subproc.rs` now 74 unsafe-keyword sites) split former
multi-line `unsafe { … }` clusters into per-step blocks each carrying its own
SAFETY comment; (2) the `interpreter.rs` `set_script_ast` lifetime-widen
acquired a second `from_raw_parts` site for the `JSValueRaw` cast at
`:475–484`; (3) `IOWriter`/`IOReader` gained a `state()` accessor helper that
turned 3 inline `&mut *self.state.get()` sites into a single point-of-use
block per call.

SAFETY-comment density: **259 SAFETY** lines against 293 keyword sites
(≈ **88 %**). Strongest files: `subproc.rs` (63 SAFETY / 74 sites — every
`heap::into_raw`/`from_raw` pair, every `*out_subproc = subprocess` lifetime
hand-off, every `Arc::as_ptr` cast names its invariant), `interpreter.rs`
(44/55, every state-arena `*const` reborrow carries a `Cell`-aliasing
explanation), `IOWriter.rs`/`IOReader.rs` (single-threaded shell + UnsafeCell
discipline named in module-level doc). Weakest: `builtin/rm.rs` (30/41 — the
DirTask + ShellRmTask `unsafe impl Send` block at `:710-714` is a single
shared SAFETY comment for two distinct types) and `builtin/cp.rs`
(`OutputTask::on_io_writer_chunk` shim sites lean on the upstream
`output_task.rs` comment).

## Per-file unsafe distribution

| file                                                  | unsafe-keyword sites (mapper) | extern "C" decls |
|-------------------------------------------------------|-------------------------------|------------------|
| `src/runtime/shell/subproc.rs`                        | 74                            | 1                |
| `src/runtime/shell/interpreter.rs`                    | 55                            | 0                |
| `src/runtime/shell/builtin/rm.rs`                     | 41                            | 0                |
| `src/runtime/shell/builtin/cp.rs`                     | 16                            | 0                |
| `src/runtime/shell/states/Cmd.rs`                     | 12                            | 0                |
| `src/runtime/shell/shell_body.rs`                     | 12                            | 1                |
| `src/runtime/shell/Builtin.rs`                        | 10                            | 0                |
| `src/runtime/shell/builtin/ls.rs`                     | 8                             | 0                |
| `src/runtime/shell/IOWriter.rs`                       | 7                             | 0                |
| `src/runtime/shell/IOReader.rs`                       | 7                             | 0                |
| `src/runtime/shell/dispatch_tasks.rs`                 | 6                             | 0                |
| `src/runtime/shell/builtin/yes.rs`                    | 5                             | 0                |
| `src/runtime/shell/builtin/mkdir.rs`                  | 5                             | 0                |
| `src/runtime/shell/states/Expansion.rs`               | 4                             | 0                |
| `src/runtime/shell/builtin/touch.rs`                  | 4                             | 0                |
| `src/runtime/shell/builtin/mv.rs`                     | 4                             | 0                |
| `src/runtime/shell/RefCountedStr.rs`                  | 4                             | 0                |
| `src/runtime/shell/IO.rs`                             | 4                             | 0                |
| `src/runtime/shell/EnvStr.rs`                         | 4                             | 0                |
| `src/runtime/shell/states/Base.rs`                    | 2                             | 0                |
| `src/runtime/shell/ParsedShellScript.rs`              | 2                             | 0                |
| `src/runtime/shell/states/{Subshell,Stmt,Script,Pipeline}.rs` | 4 (1 each)            | 0                |
| `src/runtime/shell/builtin/export.rs`                 | 1                             | 0                |
| **Section H**                                         | **293**                       | **2**            |

## Unsafe-impl Send/Sync inventory

| site                                       | impl                          | safety_status                                                                                                                                  |
|--------------------------------------------|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------|
| `IOWriter.rs:243–244`                      | `Send + Sync` for `IOWriter`  | PRESENT_STRONG — "shell is single-threaded; `Arc` is used purely for refcounting … no cross-thread access." Backed by UnsafeCell<State> only. |
| `IOReader.rs:82–83`                        | `Send + Sync` for `IOReader`  | PRESENT_STRONG — twin of IOWriter, same comment shape.                                                                                         |
| `builtin/rm.rs:713–714`                    | `Send` for `ShellRmTask` + `DirTask` | PRESENT_WEAK — "raw-pointer fields are only dereferenced on the threads that own them; atomics + `err` mutex provide synchronisation."  Single comment shared across two distinct types. |

No `unsafe impl Sync` for the rm tasks (worker pool sees them strictly
single-owned at a time, transferred via the work-pool dispatch boundary).

## extern "C" decls

| site                          | symbol                                              | safety_status |
|-------------------------------|-----------------------------------------------------|---------------|
| `subproc.rs:2509–2513`        | `safe static BUN_DEFAULT_PATH_FOR_SPAWN: *const c_char` | PRESENT_STRONG — `safe` modifier; comment names the load-time-init + immutable-rodata contract. |
| `shell_body.rs:223`           | (lexer C-bridge thunks, ported from shell-parser side) | PRESENT_WEAK — inherits the lexer FFI block from `bun_shell_parser`. |

## UnsafeCell decls

`IOReader.rs:77–78` (`reader: UnsafeCell<ReaderImpl>`, `state: UnsafeCell<State>`) and
`IOWriter.rs:238` (`state: UnsafeCell<State>`). All three are documented as the
**single mutation gate** for `Arc<Self>`-shared, re-entrant callbacks under the
shell's single-threaded invariant. The split between `reader` and `state` in
`IOReader` is load-bearing: re-entrant callbacks touch only `state`, never
`reader`, eliminating the worst nested-borrow case.

## Buckets (UB-TAXONOMY) distribution (heuristic from prior audit + mapper)

| bucket                                       | approx count | dominant sites                                           |
|----------------------------------------------|--------------|----------------------------------------------------------|
| **1** raw-ptr / Stacked-Borrows aliasing     | ~95          | `subproc.rs` `*out_subproc`, state-arena `*const` reborrows, `Arc::as_ptr` parent backrefs |
| **3** uninit / `MaybeUninit`                 | ~5           | `Box::<Subprocess>::new_uninit` → `ptr::write` (`subproc.rs:763–820`) |
| **5** dangling-after-drop / use-after-free   | ~15          | `cmd_parent` BackRef, `*mut Cmd` callbacks                |
| **9** FFI / `extern "C"` thunks              | ~70          | spawn FFI, libuv pipe FFI, dirent iterator FFI            |
| **13** lifetime erasure / `'static`-widening | ~8           | `set_script_ast` arena erasure, EnvStr `Slice` int-round-trip, dispatch-task Arc pinning |
| **17** Send/Sync soundness                   | ~6           | 3 unsafe Send+Sync impls (see above)                      |
| **21** alloc/dealloc + heap-pair lifecycle   | ~55          | `bun_core::heap::into_raw`/`take`/`destroy` cycles around ShellTask, ShellGlobTask, FileSink, Subprocess |
| **22** UnsafeCell interior mutability        | ~3           | IOWriter/IOReader state                                   |
| (other)                                      | ~36          | atomic ordering, slice_from_raw_parts, etc.               |

## Macro-generated vs source-direct

| macro                              | site                                          | what it emits                                              | unsafe sites emitted |
|------------------------------------|-----------------------------------------------|------------------------------------------------------------|----------------------|
| `shell_builtins!`                  | `Builtin.rs:82`                               | The `Builtin` enum + per-variant dispatch                  | ~30 (via the per-variant `unsafe { interp.as_cmd_mut(cmd) … }`-style projections in each Cmd state-machine entry point) |
| `node_accessors!`                  | `interpreter.rs:186`                          | Typed `as_cmd_mut(id)`, `as_pipeline_mut(id)`, etc. accessors over the flat state-arena `Vec<Slot>` | ~28 (each accessor body is a single documented `unsafe { &mut *(slot.as_mut_ptr().cast::<T>()) }` reborrow) |
| `shell_state_dispatch!`            | `interpreter.rs:838`                          | The state-machine dispatch table                           | ~8 (per-variant `unsafe` typed reborrow at dispatch entry) |
| `shell_task_ctx!`                  | `interpreter.rs:2907`                         | `ShellTaskCtx` impls for thread-pool tasks                 | ~12 (`run_from_main_thread` `heap::take` pair stamps) |
| `link_impl_ProcessExit!` (`bun_spawn`) | `subproc.rs:332`                          | Process-exit callback link                                 | ~3                   |

The remaining ~210 sites are SOURCE_DIRECT. The `node_accessors!` /
`shell_state_dispatch!` pair is the single largest concentration of "shape-
identical" unsafe in the section: every state-machine method routes through
the same `slot.as_mut_ptr().cast::<T>()` reborrow, all justified by the same
arena invariant (Slots are never freed below their NodeId, and the discriminant
tag is checked in debug at every projection).

## Prior-audit cross-reference

277 prior `S-NNNNNN` sites map cleanly onto current file:line ranges (the
mapper's per-file delta is concentrated in `subproc.rs` and `interpreter.rs`,
not relocations). No prior-audit anchors land on Section H (per Phase 0:
`anchored_witness: null`). Sample mappings:

| prior id  | file                                  | current line | normalized                                                    |
|-----------|---------------------------------------|--------------|---------------------------------------------------------------|
| S-007999  | `Builtin.rs`                          | 355          | `pub unsafe fn write_no_io_to(…)`                              |
| S-008003  | `Builtin.rs`                          | 549          | `unsafe { &*interp.as_cmd(cmd).node }`                         |
| S-008007  | `builtin/cp.rs`                       | 198          | `unsafe { ShellCpTask::schedule(task) }`                       |
| S-008008  | `builtin/cp.rs`                       | 218          | `unsafe { OutputTask::<Cp>::on_io_writer_chunk(…) }`           |

Full mapping is straightforward from `.unsafe-audit/unsafe-inventory.jsonl`
(filter `.file | startswith("src/runtime/shell/")`); no orphaned prior IDs.

## Spawn/pipe FFI surface (subproc.rs)

74 unsafe-keyword sites; the load-bearing block is `spawn_maybe_sync_impl`
(`:594–860`), which:

1. Builds `spawn_args.argv` as `Vec<*const c_char>` with a null sentinel
   (debug-asserted at `:699`).
2. Pushes a trailing `null` into `spawn_args.env_array` (`:701`) and calls
   `bun_process::spawn_process(&spawn_options, argv.as_ptr(), env_array.as_ptr())`.
3. **Buffer-lifetime contract**: the `inherited_env_storage: Option<bun_dotenv::NullDelimitedEnvMap>`
   on `:611` owns the K=V\0 backing storage; raw `*const c_char` pointers
   inside `spawn_args.env_array` borrow into `inherited_env_storage.storage`,
   and the local is kept on-stack across `spawn_process` so the borrow remains
   valid for the duration of the FFI call. Documented at `:607–610`.
4. Two-phase init (`:759–824`): `Box::<Subprocess>::new_uninit()` → write
   `*out_subproc = subprocess` BEFORE any callback re-entry, then
   `subprocess.write(Subprocess { … })` populates the slot once stdin/stdout/
   stderr handlers are constructed. The out-pointer write is paired with the
   doc at `:599–602` ("this function may invoke callbacks that expect a fully
   initialized parent object").
5. Windows-specific deinit on spawn failure (`:714–722`, `:731–739`): walks
   `spawn_options.stdin/.stdout/.stderr.deinit()` + `extra_fds`, citing the
   missing-Drop hazard ("`WindowsSpawnOptions` has no Drop … so an implicit
   `drop(spawn_options)` is a no-op and leaks the pipe handles open in the uv
   loop").

The pipe path (`:1043–1052`): `FileSink::create_with_pipe(event_loop, uv_pipe)`
takes ownership of a `Box<uv::Pipe>` via `bun_core::heap::into_raw`; teardown
goes through `(*pipe_ptr).writer.with_mut(|w| w.start_with_current_pipe())`.
The Arc-as-mut-ptr round-trips for `PipeReader` (`:498–521`) use `Arc::as_ptr(&pipe).cast_mut()`
with a `debug_assert_eq!(Arc::strong_count(pipe), 1)` precondition.

## Dirent-parser consumer audit (Section P parser)

Both `shell::builtin::ls` (`:516`) and `shell::builtin::rm` (`:1100`) consume
`bun_sys::dir_iterator::iterate(fd)` — Section P's parser, the one carrying
the `unsafe impl Send/Sync for Name` lifetime-erasure hazard (per Section D's
verdict).

**Lifetime upheld at every consumer site**:
- `ls.rs:522–539`: `match iterator.next()` arms read `current.name.slice_u8()`
  and pass to `this.add_entry(name, fd)` which copies bytes into
  `this.output: Vec<u8>` before the next `iterator.next()` call.
- `rm.rs:1111–1146`: `current.name.slice_u8()` is consumed by `self.enqueue(…)`
  (DirTask path, copies into a freshly heap-allocated DirTask) or by
  `self.remove_entry_file(file_path.as_zstr(), …)` after `ZBox::from_bytes(joined.as_bytes())`
  copies the joined path. Never stored across iterator-state mutation.

So while Section H **is** one of Section P's six at-risk consumers, the
ls/rm copy-out-before-next-step discipline is sound today. The
recommended Section D → Section P migration (P-001 in the Section D verdict)
would close the latent hazard without requiring any consumer-side change in
this section.

## Glob integration (Section R)

`bun_glob::BunGlobWalkerZ` is consumed at three sites:
- `shell_body.rs:64`: `pub type GlobWalker = bun_glob::BunGlobWalkerZ;` (type alias only)
- `states/Expansion.rs:319`: `BunGlobWalkerZ::init_with_cwd(…)` for the
  Expansion-state glob walk
- `dispatch_tasks.rs:136, 171, 189, 192`: `ShellGlobTask` owns the walker and
  drives `bun_glob::walk::Iterator::new(walker)` on a worker thread; result is
  shipped back to main via `run_from_main_thread`.

The `dispatch_tasks.rs` flow uses `bun_core::heap::alloc` / `heap::take` to
trampoline the task struct across threads (`:175, :184, :156`), with paired
SAFETY comments at every step. The walker's `SENTINEL=true` variant
NUL-terminates each path; `walk_impl` strips it (`:201–207`) so the argv word
boundary does not carry an embedded zero. Clean integration — no
shell-side unsafe is introduced by the glob path beyond the standard
ShellTask heap-lifecycle stamps.

## Concurrency notes

`concurrency: yes` (per Phase 0). The shell is **logically single-threaded**
(every interpreter mutation runs on the JS thread) but **physically
multi-threaded** because (a) `ShellGlobTask` and `ShellCpTask` /
`ShellRmTask` / `ShellLsTask` run on the work pool, (b) `IOWriter` /
`IOReader` integrate with libuv on Windows. The synchronization story:

- Work-pool tasks own all `unsafe` raw-pointer fields (`task: ShellTask`,
  `interp: *mut Interpreter`); the `unsafe impl Send` comment on rm.rs:713
  asserts threads-only-touch-their-owned-fields with atomics for
  cross-thread error signal (`error_signal: BackRef<AtomicBool>`,
  `output_count: BackRef<AtomicUsize>`).
- `IOWriter`/`IOReader` mark `Send + Sync` to satisfy the `Arc<…>` requirement
  but the "shell is single-threaded" comment is the actual sufficient
  condition; no cross-thread access happens through the UnsafeCell<State>.
- No `RwLock` / `Mutex` / atomic-ordering subtlety in the section itself
  beyond `SeqCst` loads on `error_signal` (`rm.rs:1096, 1117`).

## Notable patterns

1. **NodeId arena + typed accessors (interpreter.rs `node_accessors!`)** — the
   shell's answer to the "stable pointer through a growing Vec" problem. Each
   state-machine type lives in `Vec<Slot>` at an index, projected via
   `as_cmd_mut(id) -> *mut Cmd` and reborrowed at the call site. Eliminates
   the entire class of `*mut Cmd`-dangle-after-vec-growth bugs documented in
   the `subproc.rs:230–234` comment.
2. **Two-phase Subprocess init** (`subproc.rs:759–824`) — out-pointer write
   before callback re-entry, then `ptr::write` of the populated struct. The
   canonical Bun answer to "FFI callback expects a parent that doesn't exist
   yet at the moment of construction".
3. **Per-field interior mutability on `Interpreter`** (`:294`) — every
   `Interpreter` field is `Cell<T>` (Copy) or `JsCell<T>` (non-Copy), so an
   overlapping `&Interpreter` is sound and the entire dispatcher can take
   `&self` without `RefCell` runtime cost.
4. **`AllocScope.zig` exists but `AllocScope.rs` does not** — the .zig
   reference implements a "drop-arena-and-everything-in-it" idiom; the Rust
   port uses `bun_alloc::Arena` directly with explicit `Drop` of
   refcount-owning types before reset. This is in line with the
   CLAUDE.md arena gotcha and is correct.

## Open questions

1. The `EnvStr::cast_slice` int-to-pointer round-trip
   (`EnvStr.rs:188–194`) is `TODO(port)`-flagged for strict-provenance.
   Codex promoted this from prose-only open question to **EXP-029** and
   confirmed the mirrored shape under `MIRIFLAGS="-Zmiri-strict-provenance"`.
   Do not list `ptr::with_exposed_provenance` as a strict-provenance fix:
   Miri strict provenance rejects that operation too. The real fix is to store
   a provenance-carrying pointer representation (or remove the borrowed-slice
   integer packing) rather than rebuilding pointers from masked addresses.
2. `ShellRmTask` + `DirTask` share a single 4-line SAFETY comment at
   `rm.rs:710–714`. Phase 2 should split into two per-type comments and
   verify the `err: Mutex<Option<…>>` is the only synchronisation point.
3. `subproc.rs:1989` ("`Box<uv::Pipe>` we cannot alias, so ownership
   transfers to") trails off in the comment block — verify the lifetime
   contract is fully spelled in the doc, not implied.
4. The `dirent_iterator` consumer pattern in ls/rm holds today; if
   Section D's recommendation to migrate Section P's parser lands, this
   section gets the upgrade for free.
