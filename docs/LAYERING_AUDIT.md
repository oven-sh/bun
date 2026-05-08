# Layering Audit — `/root/bun-5-layering-audit`

**Tier model:** T0 `bun_core/string/collections/sys` → T1 `io/aio/http/uws/uws_sys` → T2 `js_parser/resolver/bundler` → T3 `jsc` → T4 `install/http_jsc/sql_jsc` → T5 `runtime` → T6 `bun_bin`.
Low tiers must not name high-tier types.

---

## Summary

| Category | Count | Notes |
|---|---|---|
| `extern "Rust"` hooks | 27 sites (≈60 symbols) | 23 genuine; 2 should be `add-dep`; 2 should be `move-down` |
| `#[no_mangle]` Rust→Rust | 50 defs | All are bodies for the externs above; 1 misnamed |
| `*mut c_void` cross-crate erasure | 5 | 2 fixable by `move-down`/`trait-object` |
| Runtime-registered hooks (AtomicPtr/OnceLock) | 7 | 6 should convert to link-time `extern "Rust"` |
| Misplaced code (name reveals caller) | 3 | |
| Duplicate types | 14 groups | `bun_uws` ↔ `bun_uws_sys` is the bulk |
| **Total findings** | **56** | |

### Top 5 by impact

1. **`bun_uws` duplicates `bun_uws_sys` wholesale** — 11 type pairs (`us_bun_verify_error_t`, `Opcode`, `SendStatus`, `SocketKind`, `InternalSocket`, `NewSocketHandler`, `SocketGroup`, `ConnectResult`, `ConnectError`, `AnySocket`, `SocketAddress`) plus a full `ssl_wrapper` module copy. Runtime code already shims between the two (`runtime/socket/uws_handlers.rs:97`, `runtime/socket/mod.rs:152`). **Fix: merge-dup** — `bun_uws` should re-export from `bun_uws_sys` and add wrapper *methods* only. Effort: L.
2. **`io` ↔ `event_loop` 16-fn extern shim** (`__bun_io_file_poll_*`) — `bun_io` declares 16 externs that `bun_event_loop` defines, while `bun_event_loop` already depends on `bun_io`. The `FilePoll` type is split across two crates. **Fix: move-down** — sink `FilePoll` body into `bun_aio` (which both already depend on) and delete all 16 externs. Effort: L.
3. **Runtime `AtomicPtr` hooks in T0** — `NOW_HOOK`, `perf::BACKEND`, `RESET_SEGV`, `DUMP_STACK`, `TOP_LEVEL_DIR_HOOK`, `pdeathsig::HOOK`, `PURE_GLOBAL_IDENTIFIER_LOOKUP`. Per `docs/PORTING.md` §Dispatch these should be link-time `extern "Rust"`, not runtime stores (one impl exists; the linker is the registry). Effort: M.
4. **`StringPointer` defined 4×** — `bun_core`, `bun_string`, `bun_http_types`, `bun_url`. All `{offset:u32, length:u32}` `#[repr(C)]`. **Fix: merge-dup** into `bun_core` (lowest), re-export elsewhere. Effort: M.
5. **`js_parser::BundledAst.css: *mut c_void`** — type-erases `bun_css::BundlerStyleSheet`; every bundler/linker site downcasts it back. **Fix: move-down** the `BundlerStyleSheet` opaque newtype to `bun_options_types` (already a shared dep) or invert: move `BundledAst` up to `bun_bundler`. Effort: M.

---

## 1. `extern "Rust"` link-time hooks

### `src/bun_core/util.rs:1018` — `__bun_fd_path` / `__bun_fd_path_w`
**Tier:** `bun_core` (T0) ← `bun_sys` (T0)
**Smell:** Same-tier extern. `bun_sys` already depends on `bun_core`; the only reason `Display for Fd` lives in `bun_core` is that `Fd` was defined there. The syscall body needs nothing from `bun_core`.
**Fix:** move-down: relocate `Fd` (or just `impl Display for Fd`) into `bun_sys`; delete extern.
**Effort:** S

### `src/bun_core/output.rs:79` — `__BUN_OUTPUT_SINK_VTABLE`
**Tier:** `bun_core` (T0) ← `bun_sys` (T0)
**Smell:** `bun_core::output` writes through a vtable that only `bun_sys` ever fills. Same-tier link-time static.
**Fix:** extern-rust-is-correct — `bun_core` cannot depend on `bun_sys` (would invert T0 internal order). Acceptable; document as the canonical pattern.
**Effort:** —

### `src/bun_core/Global.rs:26` — `__bun_fs_events_close_and_wait` / `__bun_dump_stack_trace`
**Tier:** `bun_core` (T0) ← `bun_runtime` (T5) / `bun_crash_handler` (T1)
**Smell:** None; genuine upward calls (process-exit flush, symbolicating dump).
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/uws_sys/SocketContext.rs:13` — `__bun_uws_stat_file`
**Tier:** `bun_uws_sys` (T1) ← `bun_sys` (T0)
**Smell:** **Down-calling via extern.** `bun_sys` is *lower* than `bun_uws_sys`; the dep can be added directly (no cycle — `bun_sys` does not depend on `uws_sys`).
**Fix:** add-dep: `bun_uws_sys → bun_sys`, call `bun_sys::stat_file()` directly, delete extern + the `#[no_mangle]` at `src/sys/lib.rs:7186`.
**Effort:** S

### `src/uws_sys/Request.rs:8` — `__bun_uws_parse_date`
**Tier:** `bun_uws_sys` (T1) ← `bun_runtime` (T5)
**Smell:** Body wraps JSC's `WTF::parseDate`. Genuine.
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/dns/lib.rs:531` — `__bun_dns_prefetch`
**Tier:** `bun_dns` (T1) ← `bun_runtime::dns_jsc` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/aio/posix_event_loop.rs:141` — `__bun_get_vm_ctx`
**Tier:** `bun_aio` (T1) ← `bun_runtime` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/aio/posix_event_loop.rs:395` — `__bun_run_file_poll`
**Tier:** `bun_aio` (T1) ← `bun_runtime::dispatch` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/io/lib.rs:798` — `__bun_io_pollable_on_ready` / `_on_io_error`
**Tier:** `bun_io` (T1) ← `bun_runtime::dispatch` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/io/lib.rs:1245` — `__bun_io_file_poll_*` ×16, `__bun_io_event_loop_to_loop`, `__bun_io_pipe_read_buffer`
**Tier:** `bun_io` (T1) ← `bun_event_loop` (T1)
**Smell:** **16-function extern surface between sibling T1 crates.** `bun_event_loop` already `use bun_io`, so this is a same-tier circular split: `FilePoll`'s storage lives in `bun_aio`, accessors in `bun_event_loop`, callers in `bun_io`.
**Fix:** move-down: sink `FilePoll` + accessors into `bun_aio` (both `io` and `event_loop` already depend on it); delete all 16 externs.
**Effort:** L

### `src/event_loop/AnyEventLoop.rs:25` — `__bun_js_event_loop_*` ×18
**Tier:** `bun_event_loop` (T1) ← `bun_jsc` (T3)
**Fix:** extern-rust-is-correct (canonical Js-arm dispatch)
**Effort:** —

### `src/event_loop/MiniEventLoop.rs:49` — `__bun_stdio_blob_store_new` / `__bun_js_vm_get`
**Tier:** `bun_event_loop` (T1) ← `bun_runtime` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/event_loop/EventLoopTimer.rs:32` — `__bun_fire_timer` / `__bun_js_timer_epoch`
**Tier:** `bun_event_loop` (T1) ← `bun_runtime::dispatch` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/event_loop/SpawnSyncEventLoop.rs:46` — `__bun_spawn_sync_*` ×8
**Tier:** `bun_event_loop` (T1) ← `bun_jsc::event_loop` (T3)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/js_parser/lib.rs:146` — `__bun_macro_context_*` ×3
**Tier:** `bun_js_parser` (T2) ← `bun_js_parser_jsc` (T3+)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/resolver/lib.rs:3136` — `__bun_resolver_init_package_manager`
**Tier:** `bun_resolver` (T2) ← `bun_install` (T4)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/bundler/bundle_v2.rs:471` — `__bun_bake_get_hmr_runtime`
**Tier:** `bun_bundler` (T2) ← `bun_runtime::bake` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/bundler/bundle_v2.rs:1411` — `__bun_bundler_generate_cached_bytecode`
**Tier:** `bun_bundler` (T2) ← `bun_jsc` (T3)
**Smell:** Layering is correct (T2→T3), but the **name** encodes the *caller* not the *definer*. See §5.
**Fix:** extern-rust-is-correct (rename only)
**Effort:** S

### `src/options_types/CompileTarget.rs:22` — `__bun_http_sync_download_*` ×2
**Tier:** `bun_options_types` (T0-ish) ← `bun_runtime` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/install_types/NodeLinker.rs:93` / `src/install/PnpmMatcher.rs:16` — `__bun_regex_*` ×3
**Tier:** `bun_install_types` / `bun_install` (T2/T4) ← `bun_jsc` (T3)
**Smell:** `bun_jsc` *depends on* `bun_install` (`src/jsc/Cargo.toml:39`), so `install → jsc` would cycle. Genuine. But the *same three externs are declared twice* (NodeLinker.rs + PnpmMatcher.rs).
**Fix:** extern-rust-is-correct + merge-dup: declare once in `bun_install_types`, re-export from `bun_install`.
**Effort:** S

### `src/s3_signing/credentials.rs:150` — `__bun_s3_aws_cache_*` / `__bun_s3_boring_engine`
**Tier:** `bun_s3_signing` (T1) ← `bun_jsc::rare_data` (T3)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/jsc/ModuleLoader.rs:259` — `__BUN_LOADER_HOOKS`
### `src/jsc/VirtualMachine.rs:1744` — `__BUN_RUNTIME_HOOKS`
### `src/jsc/event_loop.rs:241` — `__bun_tick_queue_with_count` / `__bun_run_immediate_task` / `__bun_run_wtf_timer`
### `src/jsc/Task.rs:42` — `__bun_run_tasks`
**Tier:** `bun_jsc` (T3) ← `bun_runtime` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/sql_jsc/jsc.rs:313` — `__BUN_SQL_RUNTIME_HOOKS`
**Tier:** `bun_sql_jsc` (T4) ← `bun_runtime::hw_exports` (T5)
**Fix:** extern-rust-is-correct
**Effort:** —

---

## 2. `#[no_mangle]` Rust→Rust (not C++ FFI)

All ~50 `pub fn __bun_*` / `pub static __BUN_*` definitions are the bodies for §1 externs and live in the correct (higher) tier — `bun_sys`, `bun_event_loop`, `bun_jsc`, `bun_install`, `bun_runtime`, `bun_crash_handler`. No stray `#[no_mangle]` Rust-ABI fns were found that aren't paired with a §1 declaration.

One naming smell (catalogued in §5):

### `src/jsc/CachedBytecode.rs:149` — `__bun_bundler_generate_cached_bytecode`
**Tier:** defined in `bun_jsc` (T3), declared in `bun_bundler` (T2)
**Smell:** Symbol prefix `__bun_bundler_*` makes it look like bundler-owned code parked in `jsc`. Convention everywhere else is `__bun_<definer>_*`.
**Fix:** misplaced → rename to `__bun_jsc_generate_cached_bytecode`; update declaration in `bundle_v2.rs:1415`.
**Effort:** S

---

## 3. `*mut c_void` / `*mut ()` cross-crate type erasure

(C-ABI `c_void` in `*_sys` crates, allocator vtables, libc shims excluded.)

### `src/js_parser/ast/BundledAst.rs:14,59` — `css: Option<*mut c_void>`
**Tier:** `bun_js_parser` (T2) erases `bun_css::BundlerStyleSheet` (T2 peer)
**Smell:** Every consumer (`bundler/ParseTask.rs:632,1191`, `linker_context/findImportedFilesInCSSOrder.rs:112,170,324`, `scanImportsAndExports.rs:135,1413,1624`, `prepareCssAstsForChunk.rs:363`) immediately `.cast::<BundlerStyleSheet>()`. The erasure exists only because adding `bun_css` as a `js_parser` dep was deemed a back-edge — but `bun_css` does not depend on `js_parser`, so it isn't.
**Fix:** add-dep: `bun_js_parser → bun_css` (already feature-flagged in bundler); type field as `Option<NonNull<bun_css::BundlerStyleSheet>>`. If css must stay optional, gate behind `#[cfg(feature = "css")]`.
**Effort:** M

### `src/js_parser/lib.rs:1535` — `RuntimeTranspilerCache.entry: Option<*mut ()>`
**Tier:** `bun_js_parser` (T2) erases `bun_bundler::cache::RuntimeTranspilerCacheEntry` (T2)
**Smell:** Round-tripped via cast in `jsc/RuntimeTranspilerStore.rs:874`. Same-tier; bundler already depends on js_parser, so the type can't move up without inverting.
**Fix:** move-down: define `RuntimeTranspilerCacheEntry` in `bun_js_parser` (it's pure data: hash + bytes + path) and have bundler/jsc import it.
**Effort:** S

### `src/crash_handler/lib.rs:387-398` — `BundleGenerateChunk { context/chunk/part_range: *const () }`
**Tier:** `bun_crash_handler` (T1) erases `bun_bundler::{LinkerContext,Chunk,PartRange}` (T2)
**Smell:** None for the erasure (T1<T2 is genuine), but the **type names** leak bundler concepts into crash_handler (see §5).
**Fix:** extern-rust-is-correct (vtable pattern)
**Effort:** —

### `src/event_loop/EventLoopTimer.rs:225` — `ctx: Option<NonNull<c_void>>`
**Tier:** `bun_event_loop` (T1) erases timer owner (any of ~30 runtime types)
**Smell:** None — heterogeneous owner set; tag+ptr is the documented §Dispatch pattern.
**Fix:** extern-rust-is-correct
**Effort:** —

### `src/bundler/ParseTask.rs:1542` — `external: *mut c_void`
**Tier:** `bun_bundler` (T2) erases JSC plugin payload
**Smell:** None — round-trips through C++ FFI (`JSBundlerPlugin__*`).
**Fix:** extern-rust-is-correct
**Effort:** —

---

## 4. Runtime-registered hooks (should be link-time `extern "Rust"`)

Per `docs/PORTING.md:723`: when exactly one impl exists, low tier declares `extern "Rust"`, high tier defines `#[no_mangle]`. Runtime `AtomicPtr` stores are reserved for *truly dynamic* registration.

### `src/bun_core/util.rs:2991` — `NOW_HOOK: AtomicPtr<()>` + `set_timespec_now_hook`
**Tier:** `bun_core` (T0) ← written by `bun_jsc` (T3)
**Smell:** Borderline. Installed/uninstalled at runtime by `useFakeTimers`, so it *is* dynamic — but the *enabler* is always jsc.
**Fix:** extern-rust-is-correct **if** kept dynamic; otherwise convert to `extern "Rust" fn __bun_timespec_now_mocked() -> Option<Timespec>` and let jsc check its own flag.
**Effort:** S

### `src/bun_core/util.rs:3069` — `perf::BACKEND: AtomicPtr<()>` + `set_backend`
**Tier:** `bun_core` (T0) ← written once by `bun_sys::perf::init()` (T0)
**Smell:** Single provider, set once at startup. No reason for runtime store.
**Fix:** extern-rust: declare `extern "Rust" { static __BUN_PERF_BEGIN: Option<BeginFn>; }`, define `#[no_mangle]` in `bun_sys`.
**Effort:** S

### `src/bun_core/Global.rs:23` — `RESET_SEGV: AtomicPtr<()>`
**Tier:** `bun_core` (T0) ← written by `bun_crash_handler` (T1)
**Smell:** Single provider, startup-only. The neighbouring `__bun_dump_stack_trace` already uses link-time extern; this one didn't get converted.
**Fix:** extern-rust: `extern "Rust" { fn __bun_reset_segv_handler(); }`
**Effort:** S

### `src/ptr/ref_count.rs:47` — `DUMP_STACK: AtomicPtr<()>`
**Tier:** `bun_ptr` (T0) ← written by `bun_runtime::init()` (T5)
**Smell:** Single provider, startup-only.
**Fix:** extern-rust: `extern "Rust" { fn __bun_dump_stored_trace(trace: *const StoredTrace, ret: usize); }`
**Effort:** S

### `src/spawn_sys/lib.rs:146` — `pdeathsig::HOOK: AtomicPtr<()>`
**Tier:** `bun_spawn_sys` (T0) ← written by `bun_aio` (T1)
**Smell:** Single provider.
**Fix:** extern-rust
**Effort:** S

### `src/sys/lib_draft_b1.rs:88` — `TOP_LEVEL_DIR_HOOK: AtomicPtr<()>`
**Tier:** `bun_sys` (T0) ← `bun_runtime` (T5)
**Smell:** Draft file; runtime store. May be dead.
**Fix:** extern-rust (or delete if `lib_draft_b1.rs` is unreferenced)
**Effort:** S

### `src/js_parser/lib.rs:1625` — `PURE_GLOBAL_IDENTIFIER_LOOKUP: OnceLock<fn(&[u8]) -> ...>`
**Tier:** `bun_js_parser` (T2) ← written by `bun_bundler::defines` (T2)
**Smell:** Single provider, set in `Define::init`. `OnceLock` is just a fancier `AtomicPtr` here. `bundler` already depends on `js_parser`, so direct dep is impossible — but link-time extern works.
**Fix:** extern-rust: `extern "Rust" { fn __bun_pure_global_identifier_lookup(name: &[u8]) -> Option<&'static IdentifierDefine>; }`, `#[no_mangle]` in `bun_bundler::defines`.
**Effort:** S

---

## 5. Misplaced code (name reveals high-tier caller)

### `src/jsc/CachedBytecode.rs:149` — `__bun_bundler_generate_cached_bytecode`
**Tier:** body in `bun_jsc` (T3); name says `bundler`
**Smell:** Only fn in the codebase whose `__bun_<X>_` prefix names the *caller* crate instead of the *definer*. Grep for `__bun_bundler_*` finds it in `jsc/`, which is exactly the prompt's red flag.
**Fix:** rename → `__bun_jsc_generate_cached_bytecode` (definer-prefixed, matching `__bun_js_event_loop_*`, `__bun_regex_*`, etc.)
**Effort:** S

### `src/crash_handler/lib.rs:387,398` — `BundleGenerateChunk` / `BundleGenerateChunkVTable`
**Tier:** types in `bun_crash_handler` (T1); names say `bundler` (T2)
**Smell:** Low-tier crate hard-codes a high-tier concept name. The struct is just `(ctx, ctx2, ctx3, vtable)` — nothing about it is bundler-specific.
**Fix:** move-up: rename to generic `CrashAction { data: [*const (); 3], fmt: &'static ActionFmtVTable }`; keep `Action::BundleGenerateChunk` variant name only as the enum tag.
**Effort:** M

### `src/jsc/Cargo.toml:39` — `bun_jsc` depends on `bun_install`
**Tier:** `bun_jsc` (T3) → `bun_install` (T4)
**Smell:** **Tier-model inversion.** Per the stated model `install` is T4 (above `jsc`), but `jsc` lists it as a Cargo dep. Either the model is wrong or this dep should be cut. (`bun_install` in turn calls back into jsc via `__bun_regex_*` extern — so today the edge is jsc→install at compile-time and install→jsc at link-time.)
**Fix:** move-down: whatever `jsc` uses from `install` (auto-installer hook types?) should sink to `bun_install_types`.
**Effort:** M

---

## 6. Duplicate types

### `src/uws/lib.rs:122` + `src/uws_sys/lib.rs:32` — `us_bun_verify_error_t`
**Tier:** both T1
**Smell:** Two `#[repr(C)]` structs, **different field names** (`error_no` vs `error`). Runtime shims convert between them: `runtime/socket/uws_handlers.rs:97 to_uws_verify_err()`, `runtime/socket/mod.rs:152`, `uws/lib.rs:138 impl From<uws_sys::...> for uws::...`.
**Fix:** merge-dup: delete `bun_uws::us_bun_verify_error_t`; `pub use bun_uws_sys::us_bun_verify_error_t`; delete the `From`/`to_uws_verify_err` shims.
**Effort:** M

### `src/uws/lib.rs:160` + `src/uws_sys/lib.rs:74` — `Opcode(pub i32)`
**Fix:** merge-dup: re-export from `uws_sys`. **Effort:** S

### `src/uws/lib.rs:173` + `src/uws_sys/lib.rs:88` — `SendStatus`
**Fix:** merge-dup. **Effort:** S

### `src/uws/lib.rs:148` + `src/uws_sys/Response.rs:27` — `SocketAddress`
**Smell:** `uws_sys` version has a lifetime, `uws` version owns. Likely intentional borrow-vs-own split, but callers mix them.
**Fix:** merge-dup: keep `uws_sys::SocketAddress<'a>`, add `.to_owned()` in `uws`. **Effort:** S

### `src/uws/lib.rs:1189` + `src/uws_sys/SocketGroup.rs:19` — `SocketGroup`
### `src/uws/lib.rs:1174` + `src/uws_sys/SocketGroup.rs:54` — `SocketGroupVTable` (callbacks struct)
**Fix:** merge-dup: `bun_uws` re-exports. **Effort:** M

### `src/uws/lib.rs:1464` + `src/uws_sys/SocketKind.rs:20` — `SocketKind`
### `src/uws/lib.rs:1553` + `src/uws_sys/socket.rs:678` — `InternalSocket`
### `src/uws/lib.rs:1590` + `src/uws_sys/socket.rs:35` — `NewSocketHandler<SSL>`
### `src/uws/lib.rs:1218` + `src/uws_sys/SocketGroup.rs:83` — `ConnectResult`
### `src/uws/lib.rs:2208` + `src/uws_sys/socket.rs:664` — `ConnectError`
### `src/uws/lib.rs:2218` + `src/uws_sys/socket.rs:819` — `AnySocket`
**Smell:** `bun_uws` is effectively a second copy of `bun_uws_sys` rather than a safe-wrapper layer. `runtime/socket/uws_dispatch.rs:18` imports the `uws_sys` versions while `runtime/socket/socket_body.rs` imports the `uws` versions.
**Fix:** merge-dup: gut `bun_uws` to `pub use bun_uws_sys::*` + wrapper impls only.
**Effort:** L

### `src/uws/lib.rs:234` (`mod ssl_wrapper`) + `src/runtime/socket/ssl_wrapper.rs:1`
**Smell:** Full ~400-line module duplicated. `runtime` version uses `bun_uws::us_bun_verify_error_t`; `uws` version uses its own.
**Fix:** merge-dup: delete `runtime/socket/ssl_wrapper.rs`, re-export `bun_uws::ssl_wrapper`. **Effort:** M

### `src/uws_sys/ListenSocket.rs:11` + `src/uws_sys/App.rs:622` + `src/uws_sys/h3.rs:18` — `ListenSocket`
**Smell:** Three structs same name **in one crate**. `App.rs` version is `<const SSL>`, `ListenSocket.rs` is the C opaque, `h3.rs` is QUIC.
**Fix:** merge-dup: rename `h3::ListenSocket` → `H3ListenSocket`; have `App.rs` wrap `crate::ListenSocket`. **Effort:** S

### `StringPointer` ×4 — `src/bun_core/util.rs:1822`, `src/string/lib.rs:1875`, `src/http_types/ETag.rs:108`, `src/url/lib.rs:24`
**Smell:** All `#[repr(C)] { offset: u32, length: u32 }`. `bun_string`, `http_types`, `url` all already depend on `bun_core`.
**Fix:** merge-dup: keep `bun_core::StringPointer`; others `pub use bun_core::StringPointer`. **Effort:** M

### `SSLConfig` — `src/http/ssl_config.rs:22` + `src/runtime/socket/SSLConfig.rs:19`
**Smell:** `runtime` already depends on `bun_http`; no reason for a second struct. (`jsc/generated.rs:288` is codegen — exempt.)
**Fix:** merge-dup: delete `runtime/socket/SSLConfig.rs`, use `bun_http::ssl_config::SSLConfig`. **Effort:** M

---

## Appendix: clean (no action)

- `bun_alloc/*`, `*_sys/*`, `boringssl_sys`, `cares_sys` `c_void` — genuine C FFI.
- `aio::EventLoopCtxVTable` / `MINI_EVENT_LOOP_CTX_VTABLE` / `VM_EVENT_LOOP_CTX_VTABLE` — proper §Dispatch vtable instances (multiple providers).
- `ProcessExitVTable` instances (`lifecycle_script_runner`, `security_scanner`, `subprocess`) — proper multi-provider vtable.
- `bun_core/Global.rs:226` `JSC` — debug-log scope name string, not a type.
- `main_wasm.rs`, `workaround_missing_symbols.rs`, `boringssl/lib.rs:187-205` `#[no_mangle]` — C-ABI exports, out of scope.
