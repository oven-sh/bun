# Section H: runtime-shell

## Purpose

`src/runtime/shell/` is the **executor** side of Bun's cross-platform shell:
the interpreter state machine (`interpreter.rs`, `shell_body.rs`), the
state-node arena and 11 state types under `states/` (Script, Stmt, Cmd,
Pipeline, If, CondExpr, Binary, Async, Expansion, Subshell, Assigns), the
async I/O ring (`IOReader`, `IOWriter`, `IO`, `Yield`), the subprocess spawn /
teardown layer (`subproc.rs`, `dispatch_tasks.rs`), and 19 POSIX-style
builtins (`builtin/{cat,cp,ls,mv,rm,mkdir,touch,…}.rs`). The **lexer and
parser** live in Section R (`bun_shell_parser`); Section H consumes the AST,
walks it, and drives FFI: subprocess spawn (`bun_process::spawn_process`),
libuv pipes on Windows, the dirent parser (`bun_sys::dir_iterator` — the
Section P module), and `bun_glob::BunGlobWalkerZ` for word expansion.

## Unsafe-surface tally (vs prior 277)

**293 unsafe-keyword sites** across 26 files (`unsafe { … }` blocks: 237;
`unsafe fn`: 42; `unsafe impl`: 6; `unsafe extern "C"`: 2; `UnsafeCell` decls:
3). Delta `+16` (~+5.8 %) vs prior 277. Three causes account for the entire
delta: (a) the `ShellSubprocess::spawn_maybe_sync_impl` rewrite split former
multi-line `unsafe { … }` clusters into per-step blocks each carrying its own
SAFETY comment (~+8 sites in `subproc.rs`); (b) `interpreter.rs::set_script_ast`
acquired a paired `from_raw_parts` cast for `JSValueRaw` at `:475–484` (+1);
(c) `IOWriter`/`IOReader` gained a `state()` accessor helper, then several
call sites switched from a single multi-statement block to a series of small
ones (~+4 sites). The remaining ~+3 sites are scattered across `builtin/cp.rs`
and `builtin/rm.rs` task-scheduling shims.

SAFETY-comment density: **259 SAFETY** lines / 293 unsafe sites ≈ **88 %** —
mid-pack for the project (Section B is ~81 %, Section D ~75 %; the
single-threaded shell invariant is repeatedly cited so per-block prose is
shorter). The strongest files are `subproc.rs` (63 SAFETY / 74 sites — every
`heap::into_raw`/`from_raw` pair, every two-phase init step,
every libuv pipe transfer names the invariant), `interpreter.rs` (44/55), and
both `IOWriter` / `IOReader` (module-level discipline carries every block).
Weakest: `builtin/rm.rs` (30/41 — the `unsafe impl Send for ShellRmTask /
DirTask` block at `:710–714` uses one shared SAFETY comment for two distinct
types, and several `OutputTask::on_io_writer_chunk` shim sites lean on the
upstream comment in `output_task.rs`).

## spawn/pipe FFI audit

The full spawn surface is in `subproc.rs::ShellSubprocess::spawn_maybe_sync_impl`
(`:594–860`). It delegates to `bun_process::spawn_process` (the cross-platform
spawn wrapper that handles `posix_spawn` on POSIX and `CreateProcess` / libuv
`uv_spawn` on Windows) — Section H itself contains **zero direct
`posix_spawn` / `CreateProcess` calls**. The hazards live at the argument-
preparation and result-handoff boundaries:

1. **`argv` / `env_array` buffer lifetimes**. `spawn_args.argv: Vec<*const c_char>`
   and `spawn_args.env_array: Vec<*const c_char>` are passed by `.as_ptr()`
   into `spawn_process`. The actual K=V\0 storage lives in
   `inherited_env_storage: Option<bun_dotenv::NullDelimitedEnvMap>` allocated
   at `:611` and kept on-stack until after `spawn_process` returns; the doc
   comment at `:607–610` explicitly names the lifetime contract ("Zig used the
   spawn-local arena freed at function exit; here the struct keeps the buffers
   alive until after `spawn_process` returns"). Null-sentinel discipline is
   maintained: `spawn_args.argv.last().is_null()` is debug-asserted at `:699`;
   `spawn_args.env_array.push(core::ptr::null())` is unconditionally called at
   `:701`.
2. **Two-phase Subprocess init**. `Box::<Subprocess>::new_uninit()` at `:763`
   yields a stable `*mut Subprocess`; **before** any callback re-enters,
   `*out_subproc = subprocess` (`:771`) is written so re-entrant `Cmd`
   callbacks see a populated `exec.subproc.child`. Stdin/stdout/stderr
   are constructed against the bare pointer (`Writable::init` /
   `Readable::init` take `subprocess: *mut Subprocess`), then
   `subprocess.write(Subprocess { … })` (`:805–819`) populates the slot.
   SAFETY comments at `:765–770`, `:802–804` spell out the
   "fully-initialised parent for callback re-entry" contract.
3. **Spawn-failure Windows deinit** (`:714–722`, `:731–739`). The comment at
   `:709–713` names the trap door precisely: `WindowsSpawnOptions` has no
   `Drop`, its `Stdio::Buffer`/`Ipc` carry FFI-owned `*mut uv::Pipe` already
   `uv_pipe_init`ed by `spawn_process_windows` before `uv_spawn` fails, so an
   implicit `drop(spawn_options)` is a no-op and **leaks the pipe handles
   open in the uv loop**. The manual `.deinit()` walk is the fix.
4. **Pipe ownership transfer** (`:1043–1052`, `:1989`). `Box<uv::Pipe>` →
   `bun_core::heap::into_raw` → `FileSink::create_with_pipe` — ownership
   transfers; `(*pipe_ptr).writer.with_mut(|w| w.start_with_current_pipe())`
   is the access path. Pipe-reader Arc round-trips at `:498–521` carry a
   `debug_assert_eq!(Arc::strong_count(pipe), 1)` precondition before the
   `Arc::as_ptr(&pipe).cast_mut()` cast.
5. **`safe extern "C" static BUN_DEFAULT_PATH_FOR_SPAWN`** at `:2509–2513` —
   the `safe` modifier + load-time-init + immutable-rodata SAFETY comment
   make this trivially sound.

No `posix_spawn_file_actions_*` shape is reachable from Section H directly;
all of those live behind the `bun_process` wrapper, which is Section T's
problem.

## dirent-parser consumer audit (`shell::builtin::{ls,rm}`)

Both consumers route through `bun_sys::dir_iterator::iterate(fd)` — the
Section P parser flagged in Section D's notes as the project's six-consumer
lifetime-erasure hazard (`Name { ptr: NonNull<u8>, len }` with `unsafe impl
Send/Sync`).

- **`builtin/ls.rs:516–539`**: `let mut iterator = dir_iterator::iterate(fd);`
  → `match iterator.next() { Ok(Some(current)) => { let name = current.name.slice_u8(); this.add_entry(name, fd); … } }`. `add_entry` copies bytes
  via `this.output.extend_from_slice(name)` before the next `iterator.next()`
  call. The `add_dot_entries_if_needed(fd)` helper synthesises `.` and `..`
  by string-literal, not by re-reading the iterator. Lifetime upheld.
- **`builtin/rm.rs:1100–1146`**: same `iterator.next()` loop; on
  `EntryKind::Directory` the name is passed to `self.enqueue(dir_task,
  current.name.slice_u8(), …)` which allocates a fresh `DirTask` and copies
  the bytes into it; on any other kind, the name is joined into `buf` and
  copied into a `ZBox::from_bytes(joined.as_bytes())` **before** the iterator
  state can advance. Lifetime upheld.

Both consumers also poll an `error_signal: AtomicBool` between iterations
(`rm.rs:1117`) — the only cross-thread synchronisation in the dirent loops.

**Verdict**: Section H is one of Section P's six at-risk consumers, but the
copy-out-before-next-step discipline at every call site is sound today. The
hazard is latent on the parser side, not the consumer side. Section D's
recommendation to migrate Section P's parser to the PathString-owned Section
D template is the structurally correct fix; if it lands, Section H gets the
upgrade with no consumer-side change required.

## glob integration with bun_glob (Section R)

Three consumer sites:
- `shell_body.rs:64`: `pub type GlobWalker = bun_glob::BunGlobWalkerZ;` (type
  re-export only — zero unsafe).
- `states/Expansion.rs:319`: `bun_glob::BunGlobWalkerZ::init_with_cwd(arena, cwd, pattern, syscall_accessor)` — drives Expansion-state glob walks.
- `dispatch_tasks.rs:131–209`: `ShellGlobTask { walker: bun_glob::BunGlobWalkerZ, … }` owns the walker and runs `bun_glob::walk::Iterator::new(walker)` on the
  work pool (`run_from_thread_pool`), then ships results back to the main
  thread via `run_from_main_thread → bun_core::heap::take(this) → Expansion::on_glob_walk_done`.

The trampoline allocator pair is documented at every step (`heap::alloc` at
`:175`, `heap::take` at `:156`, `ShellTask::schedule` at `:184`). The
walker's SENTINEL=true variant NUL-terminates each path; `walk_impl` strips
it (`:201–207`) so argv word boundaries don't carry embedded zeros.

**Section H introduces no unsafe specific to the glob integration** beyond
the standard ShellTask heap-lifecycle stamps. The Section R `bun_glob`
audit is the source of truth for the walker's internal soundness.

## Notable patterns

1. **NodeId arena + typed accessors (`node_accessors!` in `interpreter.rs:186`)**.
   Every state-machine type lives in `Vec<Slot>` at a `NodeId` index;
   `as_cmd_mut(id) -> *mut Cmd` projects a typed pointer from the flat slot,
   reborrowed at the call site. This eliminates the `*mut Cmd`-dangles-after-
   vec-grows class of bugs that the `subproc.rs:230–234` comment calls out as
   the single biggest difference from a naive port. Macro-generated and so
   uniformly applied; ~28 emitted unsafe sites, all shape-identical, all
   covered by the same NodeId invariant.
2. **Two-phase Subprocess init** (`subproc.rs:759–824`). Out-pointer write
   BEFORE any callback re-enters; `ptr::write` of the populated struct
   AFTER stdin/stdout/stderr handlers are constructed against the bare
   pointer. The canonical Bun answer to "FFI callback expects a parent that
   doesn't exist yet at the moment of construction".
3. **Per-field interior mutability on `Interpreter`** (`interpreter.rs:294–299`).
   Every field is `Cell<T>` or `JsCell<T>`, so an overlapping `&Interpreter`
   is sound and the dispatcher takes `&self` without `RefCell` runtime cost.
   Documented as "behind `UnsafeCell`, an overlapping `&Interpreter` is
   sound".
4. **Single-threaded UnsafeCell discipline on `IOWriter`/`IOReader`**.
   `Send + Sync` is asserted only to satisfy the `Arc<…>` requirement; the
   actual invariant is "shell is single-threaded; no cross-thread access".
   Reader/state split (`IOReader.rs:77–78`) means re-entrant callbacks touch
   only `state`, never `reader`, eliminating the worst nested-borrow case.

## Open questions

1. **`EnvStr::cast_slice` int-to-pointer round-trip** (`EnvStr.rs:188–194`,
   `:197–200`) is now **EXP-029**, not merely an open question. A strict-
   provenance Miri mirror reproduces the failure at `self.ptr() as usize as
   *const u8`. The `Tag::Refcounted` path has the same integer-to-pointer
   shape through `cast_ref_counted`. The durable fix is to store provenance-
   carrying pointer state (or otherwise avoid borrowed-slice integer packing).
   `core::ptr::with_exposed_provenance` is not a strict-provenance-clean fix;
   it only makes the exposed-provenance dependency explicit and is rejected by
   `-Zmiri-strict-provenance` just like the current cast.
2. **`ShellRmTask` + `DirTask` shared SAFETY comment** at `rm.rs:710–714`.
   The two `unsafe impl Send` lines share one comment for two distinct types
   with different field shapes; Phase 2 should split into two per-type
   comments and verify `err: Mutex<Option<…>>` is the only synchronisation
   point for both. The fact that this single block was sufficient under the
   prior audit suggests the discipline is sound, just under-documented.
3. **`subproc.rs:1989`** trailing comment ("`Box<uv::Pipe>` we cannot alias,
   so ownership transfers to") — verify the lifetime contract is fully
   spelled out, not truncated. Quick read suggests the sentence completes
   in the following lines but the block boundary is awkward; Phase 2
   review-pass candidate.
4. **Dirent-parser migration** — Section D's recommendation to migrate
   Section P's parser to the PathString-owned template would eliminate
   Section H's latent T1 finding with no consumer-side change here.
   Cross-section coordination item, not a Section H deliverable.
