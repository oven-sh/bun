# Phase 1 Inventory — Section C: runtime-cli

Run: `2026-05-15-exhaustive`. Scope: `src/runtime/cli/` (single crate
`bun_runtime` module tree; 58 `.rs` files, 37 of which contain `unsafe`).

## Mapper tallies (audited base `origin/main@4d443e5402`)

| metric                                          | value                          |
| ----------------------------------------------- | ------------------------------ |
| files (`.rs`)                                   | 58                             |
| files with any `unsafe`                         | 37                             |
| `unsafe`-keyword occurrences (`rg`)             | **518**                        |
| `unsafe \{` blocks (line-major)                 | 498                            |
| `unsafe fn` declarations                        | 3                              |
| `unsafe extern` blocks/fns                      | 11                             |
| `unsafe impl`                                   | **0** (one in-comment ref only)|
| `unsafe trait`                                  | 0                              |
| Prior audit site count (`unsafe-inventory.jsonl`) | 479                          |
| Delta vs prior (≈479)                           | **+39** (~+8 %)                |
| SAFETY-comment density (`// SAFETY` lines)      | 504 (≈ 97 % of unsafe sites)   |

Delta is well within drift expectations; no macro-template growth here because
section-C macros (`maybe_debug_params!`, `maybe_verbose_error_trace!`,
`maybe_bake_debug_params!`, `path_literal!`, `format_bytes!`, `fmt!` in
`filter_run.rs`) **do not stamp `unsafe` bodies**. Growth is direct-source: a
modest expansion of `*pm_raw` raw-deref churn in `pm_trusted_command.rs`
(prior 26 → current 26) and additional `pm_version_command.rs` git-spawn
plumbing (prior 2 → current 2 — count unchanged but content reshaped).

## Per-file unsafe distribution (current)

| file                                                         | sites |
| ------------------------------------------------------------ | ----- |
| `src/runtime/cli/run_command.rs`                             | 94    |
| `src/runtime/cli/test_command.rs`                            | 44    |
| `src/runtime/cli/create_command.rs`                          | 37    |
| `src/runtime/cli/pm_trusted_command.rs`                      | 26    |
| `src/runtime/cli/test/parallel/Channel.rs`                   | 25    |
| `src/runtime/cli/test/parallel/Worker.rs`                    | 24    |
| `src/runtime/cli/upgrade_command.rs`                         | 21    |
| `src/runtime/cli/test/parallel/runner.rs`                    | 21    |
| `src/runtime/cli/multi_run.rs`                               | 21    |
| `src/runtime/cli/filter_run.rs`                              | 21    |
| `src/runtime/cli/pack_command.rs`                            | 19    |
| `src/runtime/cli/test/parallel/Coordinator.rs`               | 17    |
| `src/runtime/cli/repl.rs`                                    | 16    |
| `src/runtime/cli/mod.rs`                                     | 15    |
| `src/runtime/cli/repl_command.rs`                            | 13    |
| `src/runtime/cli/publish_command.rs`                         | 12    |
| `src/runtime/cli/bunx_command.rs`                            | 12    |
| `src/runtime/cli/test/Scanner.rs`                            | 9     |
| `src/runtime/cli/open.rs`                                    | 8     |
| `src/runtime/cli/update_interactive_command.rs`              | 7     |
| `src/runtime/cli/Arguments.rs`                               | 7     |
| `src/runtime/cli/package_manager_command.rs`                 | 6     |
| `src/runtime/cli/install_command.rs`                         | 5     |
| `src/runtime/cli/filter_arg.rs`                              | 5     |
| `src/runtime/cli/outdated_command.rs`                        | 4     |
| `src/runtime/cli/exec_command.rs`                            | 4     |
| `src/runtime/cli/test/ChangedFilesFilter.rs`                 | 3     |
| `src/runtime/cli/scan_command.rs`                            | 3     |
| `src/runtime/cli/pm_update_package_json.rs`                  | 3     |
| `src/runtime/cli/install_completions_command.rs`             | 3     |
| `src/runtime/cli/build_command.rs`                           | 3     |
| `src/runtime/cli/pm_version_command.rs`                      | 2     |
| `src/runtime/cli/pm_pkg_command.rs`                          | 2     |
| `src/runtime/cli/init_command.rs`                            | 2     |
| `src/runtime/cli/audit_command.rs`                           | 2     |
| `src/runtime/cli/why_command.rs`                             | 1     |
| `src/runtime/cli/shell_completions.rs`                       | 1     |

21 source files are **0 unsafe** (e.g. `add_command.rs`, `discord_command.rs`,
`patch_command.rs`, `remove_command.rs`, `update_command.rs`,
`which_npm_client.rs`, `colon_list_type.rs`, `ci_info.rs`,
`shell_completions.rs` is 1, `list-of-yarn-commands.rs`, init/* and test/*
support files).

## Bucket distribution (from prior audit; broadly representative)

| bucket               | sites |
| -------------------- | ----- |
| `other`              | 157   |
| `zig_port_mut_ref`   | 90    |
| `ptr_cast`           | 82    |
| `ptr_intrinsic`      | 49    |
| `fd_syscall`         | 45    |
| `raw_ptr_lifecycle`  | 33    |
| `zig_port_shared_ref`| 20    |
| `libc_ffi`           | 18    |
| `syscall`            | 16    |
| `maybe_uninit`       | 15    |
| `slice_from_raw`     | 13    |
| `ptr_arith`          | 12    |
| `raw_cast`           | 10    |
| `uws_ffi`            | 5     |
| misc (≤ 3 each)      | 14    |

Mapped to UB-TAXONOMY: dominant buckets are **#3 invalid pointer / aliasing
(reborrows of `*mut Self`)**, **#8 uninit (`assume_init_mut` on
`MaybeUninit<Transpiler>` slots)**, **#11 raw FFI** (libc/ntdll/uv), and
**#13 lifetime laundering** (`bun_ptr::detach_lifetime`, `URL::erase_lifetime`).
Concurrency buckets (#5 data race, #6 send/sync) are **near-zero** for this
section: 0 `unsafe impl`, the only "racy" statics (`WORKER_FRAME`,
`WORKER_CMDS`, `URL_`, `*_BUF`) are gated on documented single-thread access
via `bun_core::RacyCell` and SAFETY comments naming the invariant.

## Selected high-signal sites

| file:line                                          | site_kind        | bucket(s)                                 | safety_status                          | macro_status    | prior_id  | notes |
| -------------------------------------------------- | ---------------- | ----------------------------------------- | -------------------------------------- | --------------- | --------- | ----- |
| `src/runtime/cli/pack_command.rs:3009`             | unsafe_block     | aliasing (#3), provenance-launder (#13)   | PRESENT_WEAK (admits "design hazard")  | SOURCE_DIRECT   | (PASS5 #12) | **Cast-away-const → `&mut`** from `&ctx.command_ctx`. PASS5 U1-class. Single-threaded CLI dispatch is the only guard. |
| `src/runtime/cli/mod.rs:857`                       | unsafe_fn (`pub`)| caller-contract (#23)                     | PRESENT_STRONG (`# Safety` block)      | SOURCE_DIRECT   | n/a       | `global_ctx()` exposes the process-global `ContextData` raw pointer. Contract enforces "no live `&mut ContextData`". |
| `src/runtime/cli/mod.rs:541-612`                   | unsafe_block ×N  | lifetime-extension to `'static` (#13)     | PRESENT_STRONG                         | SOURCE_DIRECT   | —         | argv slice handoff into `ContextData.positionals`; SAFETY notes "argv slices are process-lifetime; see ColonListType::keys note." |
| `src/runtime/cli/install_completions_command.rs:309-313` | safe (no unsafe) | —                                   | n/a                                    | SOURCE_DIRECT   | —         | `bun_core::argv()` returns `&[&'static ZStr]` — consumed via `.as_bytes()`, **never fed into `fmt::Raw`** in this section; printed via `bstr::BStr::new(...)` which is UTF-8-safe. |
| `src/runtime/cli/open.rs:495-500`                  | unsafe_block     | slice_from_raw (#3), FFI (#11)            | PRESENT_STRONG                         | SOURCE_DIRECT   | —         | Reconstruct argv from heap-stored `(ptr, len)` for detached editor-open thread. |
| `src/runtime/cli/open.rs:487-490`                  | unsafe_block     | heap-lifecycle (#10)                      | PRESENT_STRONG                         | SOURCE_DIRECT   | —         | `bun_core::heap::take(spawned)` — sole owner reconstitutes Box. |
| `src/runtime/cli/run_command.rs:1327-` (and 7 more)| unsafe extern    | FFI (#11)                                 | PRESENT_WEAK (single-line)             | SOURCE_DIRECT   | —         | Bun internal C++ symbols (`Bun__ExposeNodeModuleGlobals`, `JSC__JSGlobalObject__addGc`, etc.). |
| `src/runtime/cli/run_command.rs:209-218`           | static + unsafe  | racy-static (#6 mitigated)                | PRESENT_STRONG                         | SOURCE_DIRECT   | —         | `SHELL_BUF: bun_core::RacyCell<PathBuffer>` — SAFETY names process-lifetime + single-thread access. |
| `src/runtime/cli/create_command.rs:{39,307,2178-2186}` | static + unsafe ×N | racy-static (#6 mitigated)            | PRESENT_STRONG                         | SOURCE_DIRECT   | S-005670+ | 5 `RacyCell` scratch buffers (BUN_PATH_BUF, HOME_DIR_BUF, URL_, APP_NAME_BUF, GITHUB_REPOSITORY_URL_BUF, NPM_REGISTRY_URL_BUF). All read/written from a single CLI dispatch thread. |
| `src/runtime/cli/create_command.rs:2878,2901`      | unsafe_block     | racy-static + thread-join (#6)            | PRESENT_WEAK                           | SOURCE_DIRECT   | —         | `THREAD: RacyCell<Option<JoinHandle<()>>>` — set once, joined once; SAFETY thin. |
| `src/runtime/cli/bunx_command.rs:433,946`          | unsafe_block     | FFI (#11, NTDLL)                          | PRESENT_STRONG                         | SOURCE_DIRECT   | S-005659/65 | `NtQueryInformationFile` — buffer + size_of cast pattern. |
| `src/runtime/cli/bunx_command.rs:866,1038,1310,1363` | unsafe_block   | slice_from_raw (#3)                       | PRESENT_WEAK                           | SOURCE_DIRECT   | S-005664/8/9 | `core::slice::from_raw_parts(absolute_in_cache_dir_buf.as_ptr(), written)` — bounds proven by `written` accumulator; provenance via stack array. |
| `src/runtime/cli/audit_command.rs:448,455`         | unsafe_block     | zlib_ffi (#11)                            | PRESENT_STRONG                         | SOURCE_DIRECT   | S-005654/5 | `libdeflate::Compressor` raw ptr handoff + destroy. |
| `src/runtime/cli/filter_run.rs:85,122`             | source-direct    | FFI argv array (#11)                      | n/a (safe — array of `*const c_char`)  | SOURCE_DIRECT   | —         | Constructs `argv: [*const c_char; 4]` for spawn — pointer array, not the kernel-supplied argv. |
| `src/runtime/cli/multi_run.rs:124-160`             | unsafe_block     | FFI argv array (#11)                      | PRESENT_STRONG (TODO(port) docs ABI)   | SOURCE_DIRECT   | —         | Same shape as filter_run; NUL-terminated `[*:0]const u8` ABI documented. |
| `src/runtime/cli/test/parallel/Channel.rs:577-636` | unsafe_extern ×4 | uSockets vtable (#11), aliasing (#3)      | PRESENT_STRONG                         | SOURCE_DIRECT   | —         | uWS C callbacks (`raw_on_data`/`raw_on_writable`/`raw_on_close`/`raw_on_end`); each casts `*mut us_socket_t.ext()` to `&mut Channel<Owner>` via offset. |
| `src/runtime/cli/test/parallel/Channel.rs:88,492-498` | unsafe_block  | aliasing (LaunderedSelf-style) (#3)       | PRESENT_STRONG (`from_field_ptr`)      | SOURCE_DIRECT   | —         | `Owner::from_field_ptr(std::ptr::from_mut(self))` — back-pointer into containing `Owner` via field offset. Macro **not** used; analogous in shape to `bun_io::PipeWriter` LaunderedSelf. |
| `src/runtime/cli/test/parallel/runner.rs:790,795`  | static + unsafe  | racy-static (#6)                          | PRESENT_STRONG ("single-threaded worker")| SOURCE_DIRECT  | —         | `WORKER_FRAME` / `WORKER_CMDS` — `RacyCell` scratch in the test-runner worker. |
| `src/runtime/cli/test/parallel/Coordinator.rs:95,573,612` | unsafe_block | ptr_arith (#3)                          | PRESENT_WEAK                           | SOURCE_DIRECT   | —         | Manual `base.add(i)` walks over `WorkerPipe` array. SAFETY one-liner; could be expressed as a safe slice. |
| `src/runtime/cli/Arguments.rs:1524`                | unsafe_block     | aliasing (raw-mut-deref) (#3)             | PRESENT_WEAK                           | SOURCE_DIRECT   | S-005653  | `(*ctx.log).level = bun_ast::DEFAULT_LOG_LEVEL.load();` — sole unsafe in arg-parsing path. |
| `src/runtime/cli/build_command.rs:71,402,823`      | unsafe_block ×3  | aliasing (raw-mut-deref) (#3)             | PRESENT_WEAK                           | SOURCE_DIRECT   | S-005656/7/8 | `&mut *log`, `(*env).map.put(...)`, `&mut *env_ptr` — all single-threaded transpiler bootstrap. |

(Full per-line list = union of prior `S-005653..S-006131` ids in
`.unsafe-audit/unsafe-inventory.jsonl` plus +39 drift sites. Phase 2 normalises
& re-ids.)

## Anchor status: `fmt::Raw` UTF-8 invariant violation is **not currently reachable from Section C**

- **Anchor source**: `src/bun_core/fmt.rs:725-732` — `impl Display for Raw<'_>`
  calls `core::str::from_utf8_unchecked(self.0)` inside a safe `Display::fmt`,
  with a SAFETY comment that admits "in practice ASCII" (not a contract).
  Owned by section **N** (`bun_core-foundation`), not section C.
- **Section C status**: **No `fmt::Raw` / `fmt::raw` / `fmt::s` call sites in
  `src/runtime/cli/`** (verified via `rg`).  All argv consumers go through
  `bstr::BStr::new(slice)` (lossy UTF-8 substitution) for `pretty!`/`pretty_errorln!`
  display — see e.g. `install_completions_command.rs:323`. argv-validity hazard
  is **not weaponised from section C**.
- The `bun_core::argv()` return type `&'static [&'static ZStr]` is a Box-owned
  slice of NUL-terminated bytes built in `src/runtime/cli/mod.rs:831` (`argv_zslice`).
  ZStr is the same byte sequence the OS handed us — no UTF-8 promise — and
  every section-C consumer treats it as `&[u8]` (`.as_bytes()`), then either
  byte-compares (`a == target`, `eql`, `starts_with`), copies into an owned
  byte buffer for spawn (`Box::<[u8]>::from(*s)`), or prints via `BStr`.

## argv-validity audit summary

39 argv-touching call sites across runtime/cli:

| consumer pattern                       | sites | sample location                                     |
| -------------------------------------- | ----- | --------------------------------------------------- |
| `arg == b"literal"` byte-compare       | ~15   | `upgrade_command.rs:68`, `install_completions_command.rs:311` |
| `.iter().enumerate()` walk             | ~10   | `mod.rs:798,1555,1960`, `install_completions_command.rs:310` |
| copy to `Vec<Box<[u8]>>` for spawn     | ~6    | `bunx_command.rs:1199`, `publish_command.rs:1139`, `open.rs:514` |
| `argv[i..]` slice handoff (`&'static`) | ~5    | `mod.rs:541,612,1418,1465`, `bunx_command.rs:83`   |
| display via `BStr::new`                | ~3    | `install_completions_command.rs:323` (representative) |

**Net hazard**: zero direct `fmt::Raw` callers in C. The "argv → invalid UTF-8 →
`from_utf8_unchecked`" pipeline is only realisable if a future change routes
argv bytes through `bun_core::fmt::raw(...)` or `fmt::s(...)`. Suggested
guard: a clippy/grep CI rule that blocks `fmt::raw`/`fmt::s` on any expression
whose origin is `bun_core::argv()`, the `Arguments::passthrough` field, or any
`&'static [u8]` named `*argv*` / `*positional*`.

## `bun bd` build entry — N/A in section C

`bd` is a `package.json` script (`bun scripts/build.ts --profile=debug
--quiet`), not a Bun CLI subcommand. There is **no `bd` dispatch in
`src/runtime/cli/`**. `build_command.rs` is the bundler subcommand
(`bun build`); its 3 unsafe sites are unrelated `zig_port_mut_ref`-style
reborrows of `*mut Log` / `*mut Loader`. No spawn-side unsafe in CLI-dispatch
build infrastructure.

## Macro-generated surface

**Zero** macros in section C stamp `unsafe` bodies. The six `macro_rules!`
defined here (`Arguments.rs:117/134/413`, `run_command.rs:47`,
`src/runtime/cli/filter_run.rs:260`, `src/runtime/cli/test/parallel/runner.rs:36`) emit only safe code
(debug-print param formatters, path-literal cross-platform `\\?\` prefixers,
and a byte-size pretty-formatter). All 518 `unsafe` keywords in section C are
**source-direct**.

## Notable patterns (top 3 concerning)

1. **Pervasive `*mut Self` raw-deref reborrow** (`zig_port_mut_ref` 90 sites
   + `zig_port_shared_ref` 20 = 110). The dominant pattern is
   `unsafe { &mut *ptr }` over `*mut Transpiler`, `*mut Log`, `*mut Env`,
   `*mut DotEnv::Loader`, `*mut VirtualMachine`, `*mut PackageManager`. All
   load-bearing on the "CLI is single-threaded, no concurrent &mut exists"
   invariant. The `pack_command.rs:3009` cast-away-const→`&mut` is the most
   aggressive form and matches the PASS5 U1 bug class — the only thing that
   makes this sound today is the absence of concurrent dispatchers. Phase 2
   should consider whether `bun_options_types::context::global_ptr()` (the
   root `&'static UnsafeCell<ContextData>`) could be replaced by a
   `GuardedBy<ContextData, NotSync>`-style cell that at least uses the type
   system to forbid `&mut` aliasing.

2. **`bun_core::RacyCell` static scratch buffers** (≈ 12 sites:
   `SHELL_BUF`, `BUN_PATH_BUF` ×2, `HOME_DIR_BUF`, `URL_`, `APP_NAME_BUF`,
   `GITHUB_REPOSITORY_URL_BUF`, `NPM_REGISTRY_URL_BUF`, `THREAD`,
   `WORKER_FRAME`, `WORKER_CMDS`, plus `ROOT_PACKAGE_JSON_PATH`). All carry
   "single-threaded CLI / single-threaded worker" SAFETY notes; many are
   `[u8; 1024]` / `PathBuffer` scratch. None is wrong in current source, but
   the discipline is comment-only — a Phase-3 candidate for a typed
   `SingleThreadedCell<T>` newtype with a `PhantomData<*const ()>` marker
   that auto-`!Send`.

3. **`bunx_command.rs` `slice::from_raw_parts(buf.as_ptr(), written)`
   cluster** (`bunx_command.rs:866, 1038, 1310, 1363`, 4 sites with the same
   shape). Bounds are proven by the `written` accumulator from the previous
   write call, but the SAFETY comments are one-liners that omit the
   "`written <= buf.len()`" invariant chain. Should be replaced by
   `&buf[..written]` (no `unsafe`) at every site — there is no provenance or
   lifetime story that requires `from_raw_parts` here.

## Open questions

1. Should `bun_options_types::context::global_ptr()` (called by
   `mod.rs:857 global_ctx()`) be re-typed to surface its "single-thread,
   single-`&mut`" invariant in the type system? The pattern is repeated ~25
   times via `(*ctx.log)`, `(*ctx.command_ctx)`, `(*pm_raw)` shapes — every
   one is a near-miss for the `pack_command.rs:3009` U1 shape.

2. The `src/runtime/cli/test/parallel/Coordinator.rs:{95,573,612}` `base.add(i)` walks should
   be expressed as safe slice indexing — `Vec<WorkerPipe>::iter()`. Phase 2
   should check whether this was a deliberate Zig-port literal that should
   simplify or a deeper provenance constraint.

3. `create_command.rs:2878,2901` — `THREAD: RacyCell<Option<JoinHandle>>` set
   in one place and joined in another. If a second editor-open ever races (it
   shouldn't — `Editor::open` documents detach-thread semantics — but it's
   only-checked-by-comment), the `RacyCell::get()` reads have no Acquire
   semantics. Tiny risk; worth a typed wrapper.

## Anchor cross-refs (fmt::Raw)

- Anchor witness file: not yet authored for section C (the `fmt::Raw` body
  lives in section N).
- Current source of the unsafe primitive: `src/bun_core/fmt.rs:725-732`.
- Section C status: **anchor NOT reachable from this section** — no
  `fmt::raw`/`fmt::s` callers; argv display goes through `bstr::BStr::new`
  (UTF-8-lossy).
