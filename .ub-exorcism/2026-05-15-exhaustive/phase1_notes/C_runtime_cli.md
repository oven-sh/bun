# Section C: runtime-cli

## Purpose (1 crate, 58 files)

Bun's CLI dispatch — argv parsing (`Arguments.rs`), top-level command router
(`mod.rs`), and every subcommand: `bun run`, `bun test`, `bun create`,
`bun install`, `bun add`, `bun publish`, `bun upgrade`, `bun audit`,
`bun pack`, `bunx`, `bun repl`, `bun build` (bundler entrypoint), `bun
init`, the package-manager subcommands (`bun pm trust`, `bun pm version`,
`bun pm view`, …), and the test-parallel coordinator/worker IPC under
`src/runtime/cli/test/parallel/`. All sites live in the single `bun_runtime` crate; this
section is a slice of that crate, not its own Cargo target.

## Per-file unsafe-surface tally (vs prior subtotals)

| file group                            | current keyword sites | prior_count | dominant_kind                     |
| ------------------------------------- | --------------------- | ----------- | --------------------------------- |
| `run_command.rs` (run + standalone exec) | 94                 | 83          | `unsafe_block` (raw-mut deref of VM/Transpiler/Ctx) |
| `test_command.rs` (test runner driver) | 44                  | 39          | `unsafe_block` (Reporter/VM raw deref + bun_ptr::detach_lifetime) |
| `create_command.rs`                   | 37                    | 34          | `unsafe_block` over `RacyCell` static path-buffer scratch |
| `pm_trusted_command.rs`               | 26                    | 26          | `unsafe_block` (`*pm_raw` PackageManager raw deref) |
| `src/runtime/cli/test/parallel/Channel.rs` | 25               | 24          | `unsafe_extern` uWS callbacks + `from_field_ptr` reborrows |
| `src/runtime/cli/test/parallel/Worker.rs` | 24                | 24          | `unsafe_block` (coord/process raw deref) |
| `upgrade_command.rs`                  | 21                    | 20          | `unsafe_block` (archive/extract + libc env walks) |
| `src/runtime/cli/test/parallel/runner.rs` | 21                | 21          | `unsafe_block` (`WORKER_FRAME` / `WORKER_CMDS` racy statics + VM deref) |
| `multi_run.rs`                        | 21                    | 21          | `unsafe_block` (NUL-terminated argv array, posix_spawn) |
| `filter_run.rs`                       | 21                    | 20          | `unsafe_block` (argv array + dependents-graph raw deref) |
| `pack_command.rs`                     | 19                    | 17          | `unsafe_block` incl. PASS5 U1 `&mut *from_ref(...).cast_mut()` |
| `src/runtime/cli/test/parallel/Coordinator.rs` | 17           | 17          | `unsafe_block` `base.add(i)` worker-pipe walks |
| `repl.rs`                             | 16                    | 13          | `unsafe_extern` (linenoise FFI) + JSC binding |
| `mod.rs` (Command router)             | 15                    | 14          | one `pub unsafe fn global_ctx()`, rest are argv→positional handoff |
| `repl_command.rs`                     | 13                    | 12          | `unsafe_extern` (REPL Cpp init) |
| `publish_command.rs`                  | 12                    | 12          | `unsafe_block` HTTP + open URL handoff |
| `bunx_command.rs`                     | 12                    | 11          | NtQueryInformationFile + `slice::from_raw_parts(buf, written)` cluster |
| `src/runtime/cli/test/Scanner.rs`     | 9                     | 9           | `unsafe_block` test-file scanner buffer reborrows |
| `open.rs`                             | 8                     | 8           | `unsafe_block` editor-spawn argv reconstruction + heap::take |
| Arguments.rs / pack-tail / others     | ≤ 7 each              |             | `unsafe_block` (log/env raw deref, one per file) |
| **Section C total**                   | **518**               | **479**     | — |

Delta `+39`. Drivers: marginal raw-deref growth across `run_command.rs`
(+11), `test_command.rs` (+5), `repl.rs` (+3). No macro-template expansion;
no new `unsafe impl`; no new `unsafe fn` exports beyond the existing
`mod.rs:857 global_ctx`. SAFETY-comment density 504 / 518 ≈ 97 % (caveat:
this counts mentions, not strictly per-site headers — some sites carry a
multi-line SAFETY narrative).

## fmt::Raw anchor status

- **Anchor source**: `src/bun_core/fmt.rs:725-732` (owned by **section N**,
  not C).
- **Verdict for section C**: **NOT REACHABLE from this section** —
  - `rg -t rust 'fmt::Raw|fmt::raw|fmt::s\b' src/runtime/cli/` returns
    **zero matches**.
  - All argv-display sites in CLI go through `bstr::BStr::new(slice)` (lossy
    UTF-8 substitution) inside `pretty!` / `pretty_errorln!` calls. Example:
    `src/runtime/cli/install_completions_command.rs:322-326`:
    ```rust
    pretty_errorln!(
        "<r><red>error:<r> Please pass an absolute path. {} is invalid",
        bstr::BStr::new(completions_dir),
    );
    ```
  - argv slices are byte-compared (`a == b"literal"`), copied into
    `Vec<Box<[u8]>>` for spawn, or sliced into the `ContextData.positionals`
    `&'static [u8]` array — never passed through `from_utf8_unchecked`.
- **Anchor still applies in section N**; section C is the consumer surface
  that gives the anchor its "reachable from argv" framing in the prior audit
  text, but no concrete call site in `src/runtime/cli/` is the demo path
  today.

## argv-validity audit

39 argv-touching sites; full pattern breakdown in `phase1_inventory_C.md`.
Key invariants relied on:

- `bun_core::argv()` returns `&'static [&'static ZStr]`, built once in
  `bun_runtime::cli::mod::argv_zslice()` (`mod.rs:831`) by copying
  `std::env::args_os()` bytes (after NUL-checking) into Box-leaked storage.
- `ZStr` is a NUL-terminated byte slice; `.as_bytes()` returns `&[u8]`
  **with no UTF-8 promise**.
- All section-C consumers treat argv bytes as opaque bytes:
  - byte equality (`PartialEq<[u8]>` on ZStr) — sound.
  - `Vec<Box<[u8]>>` deep-copy for spawn (`bunx_command.rs:1199`,
    `publish_command.rs:1139`, `open.rs:514`) — sound.
  - `&'static [u8]` slice handoff into `ContextData.positionals`
    (`mod.rs:541-612`) with SAFETY note "argv slices are process-lifetime;
    see ColonListType::keys note." — sound.
  - Display via `bstr::BStr::new(...)` — sound (substitutes U+FFFD).

**Hazard frame**: the prior audit's "argv UTF-8 violation reachable from
fmt::Raw" requires (a) a future caller in section C to call `fmt::raw(...)`
or `fmt::s(...)` on argv bytes, or (b) `Argument` parsing to insert argv
bytes into a struct field that some other section displays via `fmt::Raw`.
Neither holds today; this is a latent CI-rule opportunity, not a live UB.

## Send/Sync impls inventory

**Zero `unsafe impl` blocks in section C.** Cross-thread state is confined
to:

- `RacyCell` statics with single-threaded-CLI SAFETY contracts
  (`run_command.rs:209 SHELL_BUF`,
  `create_command.rs:{39 BUN_PATH_BUF, 307 HOME_DIR_BUF, 2178 URL_,
  2179 APP_NAME_BUF, 2180 GITHUB_REPOSITORY_URL_BUF,
  2186 NPM_REGISTRY_URL_BUF, 2855 THREAD}`,
  `src/runtime/cli/test/parallel/runner.rs:{790 WORKER_FRAME, 795 WORKER_CMDS}`).
- The test-parallel coordinator/worker IPC over uv pipes (`Channel.rs`,
  `Worker.rs`) — concurrency lives across **process** boundaries, not
  threads.

The phase0 partition records `concurrency: no`; for thread-level Rust
concurrency in this section that is correct. Inter-process IPC over uv
pipes is a separate axis: the unsafe surface for it (Channel/Worker) is all
"per-side single-threaded; ownership transferred via posted frames", same
discipline `bun_io::PipeWriter` documents.

## `bun bd` build-entry surface

Per the prompt: **no unsafe surface in section C is on the `bd` build path**.

- `bd` is a `package.json` script: `"bd": "BUN_DEBUG_QUIET_LOGS=1 bun
  scripts/build.ts --profile=debug --quiet"`. It is dispatched by the
  installed Bun's `bun run`/`bun bd` parser long before any of the
  section-C subcommand handlers ever run.
- `build_command.rs` is the bundler subcommand (`bun build foo.ts`), not the
  `bd` wrapper. Its 3 unsafe sites
  (`build_command.rs:71`, `:402`, `:823`) are the standard
  `&mut *log` / `(*env).map.put(...)` / `&mut *env_ptr`
  `zig_port_mut_ref` shape over the Transpiler / Loader scaffolding —
  unrelated to subprocess spawn.
- The `bun run <script>` path that interprets `package.json` scripts lives in
  `run_command.rs`. It runs the script via the system shell (or `posix_spawn`
  through the runtime's process API) — argv to the spawned shell goes through
  the same `Vec<Box<[u8]>>` deep-copy as `bunx`; no UTF-8 promise required.

## Notable patterns

1. **`zig_port_mut_ref` is the dominant shape** (90 sites). All are
   `unsafe { &mut *ptr }` reborrows of a raw pointer obtained from
   `bun_options_types::context::global_ptr()` or chained through
   `Transpiler.fs`, `Transpiler.env`, `ContextData.log`, `pm.lockfile`, etc.
   The implicit invariant is "single-threaded CLI dispatch; no live `&mut`
   to the same field exists." This is true today but unenforced by the type
   system. The PASS5 U1 site (`pack_command.rs:3009`, the only
   cast-away-const-and-reborrow-as-`&mut` in section C) is the worst-shape
   instance.

2. **`bun_core::RacyCell` static scratch is the section's preferred Zig
   `@globalCache` analogue** (≈ 12 sites). All carry SAFETY notes naming
   "single-threaded CLI" or "single-threaded worker" — comment-only
   discipline that should graduate to a typed `SingleThreadedCell<T>` (a
   `RacyCell<T>` newtype that's `!Send + !Sync`). Today the type permits
   cross-thread shared access; nothing enforces the single-thread invariant.

3. **`bun_ptr::detach_lifetime` clusters in test paths**
   (`test_command.rs:2155, 2162, 2180, 2361, 2418, 2448, 2460`,
   `create_command.rs:204, 2866, 2867`). Each is "lift `&[u8]` to
   `&'static [u8]` because Zig captured a process-lifetime slice." The
   detach-lifetime invariants are documented in `bun_ptr` (section N), but
   the call sites in C are individually one-liner SAFETY.

4. **uWS callback vtables in `src/runtime/cli/test/parallel/Channel.rs`**
   (`raw_on_data` / `raw_on_writable` / `raw_on_close` / `raw_on_end`,
   lines 581-636). Each casts `(*s).ext::<PosixExt<Owner>>()` to a
   `&mut Channel<Owner>` via the documented uWS `socket_ext` slot layout.
   This is the same LaunderedSelf-style reborrow the `impl_streaming_writer_parent!`
   macro encodes in section P, but **hand-written** here. Phase 2 could
   evaluate whether the same macro could be reused.

5. **`unsafe extern "C"` FFI blocks** (11 sites: `run_command.rs:1327`,
   `repl_command.rs:303`, `repl.rs:39,65,80`, `mod.rs:1247`,
   `src/runtime/cli/test/ChangedFilesFilter.rs:390`, `src/runtime/cli/test/parallel/Channel.rs:581/593/599/611`).
   These are Bun-internal symbols (`Bun__ExposeNodeModuleGlobals`,
   `JSC__JSGlobalObject__addGc`, linenoise REPL hooks, file-watcher
   `inotify`/`FSEvents` callbacks). Standard discipline, single-line SAFETY.

## Open questions

1. Promote `bun_options_types::context::global_ptr()` to return a
   `&'static GuardedBy<ContextData, SingleThreadMarker>` so the 25-ish raw
   `(*ctx.field)` / `&mut *ptr` reborrows in section C are forced to go
   through a borrow-checked accessor? This would catch a future
   `pack_command.rs:3009`-style cast-away-const regression at compile time.

2. Add a CI lint rule that flags `fmt::raw(...)` / `fmt::s(...)` applied to
   any expression whose origin is `bun_core::argv()` or
   `ContextData.positionals` or `ContextData.passthrough`? Currently the
   "argv → fmt::Raw → UB" pipeline is closed only by social discipline.

3. Replace `bunx_command.rs:{866, 1038, 1310, 1363}` `core::slice::from_raw_parts(buf.as_ptr(), written)` with `&buf[..written]`? Same lifetimes, same provenance, no `unsafe` needed.

4. Should `src/runtime/cli/test/parallel/Coordinator.rs:{95, 573, 612}` `base.add(i)` walks
   become safe `Vec<WorkerPipe>::iter_mut()`? The current shape requires the
   `unsafe { (*v).field }` pattern for each access, multiplying the unsafe
   keyword count without any provenance gain over a safe slice.

5. The `RacyCell` static cluster
   (`create_command.rs:{39, 307, 2178-2186, 2855}`) is the largest such
   cluster in the section. Could `create_command.rs` move the scratch
   buffers onto the existing `Create` struct (heap, per-invocation) rather
   than statics? CLI dispatch always creates exactly one `Create` per
   `bun create` invocation; statics are not buying re-entrancy.

## Anchor cross-refs (fmt-raw-utf8-from-argv)

- Anchor body: `src/bun_core/fmt.rs:725-732` (Section N).
- Section C reachability: **NONE** — no `fmt::Raw` / `fmt::raw` / `fmt::s`
  callers in `src/runtime/cli/`; argv display routed through
  `bstr::BStr::new` (lossy UTF-8). Documented at
  `install_completions_command.rs:322-326`.
- Prior-audit ID: **P3-BC-001** (see
  `/data/projects/bun/.unsafe-audit/PASS3_FINDINGS_INDEX.md:56` and
  `PASS5_ACCURACY_SWEEP.md:51`). The "argv reachability" phrasing comes from
  the inventory's `install_completions_command.rs`-style consumers, but the
  actual `from_utf8_unchecked` UB lives in the Display impl, not in
  section C.
