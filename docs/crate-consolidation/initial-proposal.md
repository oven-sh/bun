## Target crate layout

### `bun_opaque`

**Absorbs**: (unchanged)
**Depends on**: —
**LOC estimate**: ~430
**Rationale**: `#![no_std]` zero-dep leaf. Must stay separate so `bun_shim_impl` (freestanding PE, no libc) can use `opaque_ffi!`/`ffi::slice` without linking any `#[no_mangle]` Bun symbols. Merging into `bun_core` would make the shim unlinkable.
**Workarounds eliminated**: none (this is a deliberate leaf, not a workaround)

### `bun_windows_sys`

**Absorbs**: (unchanged)
**Depends on**: —
**LOC estimate**: ~1,900
**Rationale**: `#![no_std]` Win32 typedefs/externs. Same shim constraint as `bun_opaque` — `src/install/windows-shim/Cargo.toml` documents that the shim binary links only `windows_sys`+`opaque`.
**Workarounds eliminated**: none

### `bun_output_tags`

**Absorbs**: (unchanged)
**Depends on**: —
**LOC estimate**: ~100
**Rationale**: `#![no_std]` ANSI-color const table shared between proc-macro crates (`bun_macros`) and runtime (`bun_core`). Proc-macro crates cannot depend on `bun_core`, so this leaf is the only way both can name `color_for()`.
**Workarounds eliminated**: none

### `bun_macros`

**Absorbs**: bun_core_macros, bun_clap_macros, bun_jsc_macros, bun_css_derive
**Depends on**: bun_output_tags
**LOC estimate**: ~4,000
**Rationale**: Single `proc-macro = true` crate. Rust forbids merging proc-macros into `[lib]` crates; consolidating all four into one is the minimum. `bun_dispatch` is **deleted**, not absorbed — every `link_interface!` is replaced by a trait object or direct call (see per-crate eliminations below). The `uws_callback` macro moves here so `bun_uws` no longer depends on a JSC-named crate.
**Workarounds eliminated**: `bun_dispatch` proc-macro crate (407 LOC) deleted outright.

### `bun_core`

**Absorbs**: bun_alloc, bun_mimalloc_sys, bun_simdutf_sys, bun_wyhash, bun_highway, bun_hash, bun_core, bun_ptr, bun_safety, bun_output, bun_collections, bun_base64, bun_errno, bun_paths, bun_libuv_sys, bun_url, bun_semver, bun_http_types, bun_analytics, bun_picohttp
**Depends on**: bun_opaque, bun_windows_sys, bun_output_tags, bun_macros
**LOC estimate**: ~88,000
**Rationale**: All pure-computation foundations: strings, formatting, allocators, hashing, collections, path manipulation, errno tables, vocabulary types (Method/MimeType/URL/semver). No syscalls. `output.rs` stays here but writes through a `static SINK: OnceLock<&'static dyn OutputSink>` that `bun_sys` installs at startup — one legitimate `dyn` for a cold path, replacing `link_interface! OutputSink`. `out_of_memory()` becomes a real fn here (print + abort) with an optional `AtomicPtr<fn()->!>` hook that `bun_sys`'s crash-handler upgrades.
**Workarounds eliminated**: `link_interface! ErrnoNames[Sys]` (errno now in-crate); `extern "Rust" __bun_crash_handler_out_of_memory` and `__bun_crash_handler_dump_stack_trace` (basic impl in-crate, hook via `AtomicPtr`); `bun_alloc::String`↔`bun_core::String` transparent-newtype split; `bun_core::perf` T0 fork; `bun_core::base64::encode` dup; `bun_core::Global::features` ↔ `analytics::features` split-brain; `bun_core::spawn_ffi` dup (types stay here, used by sys); `bun_output` façade crate; wyhash→alloc ordering constraint; `::bun_ptr::` hardcoded paths in derives become `::bun_core::ptr::`; `http_types::MimeType::by_loader(u8)` can take real `Loader` once ast is visible (stays `u8` here, fixed at call site); `semver::String` no longer drags a crate into `sourcemap`; `KNOWN_ALLOC_VTABLES` registry (safety+alloc same crate).

### `bun_sys`

**Absorbs**: bun_sys, bun_which, bun_perf, bun_platform, bun_threading, bun_spawn_sys, bun_glob, bun_watcher, bun_libarchive, bun_exe_format, bun_zlib, bun_zlib_sys, bun_zstd, bun_brotli, bun_brotli_sys, bun_libdeflate_sys, bun_crash_handler
**Depends on**: bun_core, bun_opaque, bun_windows_sys
**LOC estimate**: ~49,000
**Rationale**: Syscalls, threads, compression, fs-watcher, crash-handler — everything that talks to the OS but not to a network socket or JSC. `crash_handler` drops its `bun_ast` dep (pass `ImportKind.label()` as `&[u8]`) and its `bun_io` dep (use `bun_core::io::Write`). `spawn_sys` split dissolves (its only reason was `io→spawn→event_loop→io`, all of which are now in `bun_loop`). `watcher`'s opaque `PackageJSON`/`Loader` forward-decls stay (resolver is still above) but become `*const ()` since they're only stored, never dereferenced here.
**Workarounds eliminated**: `link_interface! OutputSink[Sys]` (impl registers into `bun_core`'s `OnceLock`); `link_interface! BundleGenerateChunkCtx[Linker]` → `crash_handler::register_action_formatter(fn(&mut dyn Write, *const ()))` plain callback; `bun_core::perf` fork; `spawn_sys→analytics` 1-line dep; `bun_core::io::Writer` head-struct vtable (use the real `Write` trait); 6 `*_sys`/wrapper crate pairs collapse.

### `bun_ast`

**Absorbs**: bun*ast, bun_parsers, bun_sourcemap, bun_dotenv, bun_options_types, bun_install_types (minus `PnpmMatcher`), bun_resolve_builtins, bun_shell_parser, bun_md, bun_clap
**Depends on**: bun_core, bun_sys
**LOC estimate**: ~68,000
**Rationale**: All non-JS parsers + all shared vocabulary/config types. This is the `*\_types`tier made honest: one crate that everything above can name for`Expr`/`Log`/`Loader`/`BundleOptions`-shape/`Dependency`/`ContextData`/`JSX::Pragma`. `PnpmMatcher`moves UP to`bun_install`(its only callers — ini/bunfig/install — are all there) so this crate has no JSC regex dependency.`TranspilerCacheImpl`becomes`Option<&'static dyn TranspilerCache>`in parser options — a normal trait object, impl in`bun_runtime`.
**Workarounds eliminated**: `link_interface! TranspilerCacheImpl[Jsc]`+ its`entry: _mut()`/`parser_options: NonNull<()>`double erasure;`bun_install_types`+`bun_options_types`as separate cycle-breaker crates;`extern "Rust" \_\_bun_regex_\*`(PnpmMatcher moved to install);`dotenv::S3Credentials`POD dup;`DirEntryProbe`trait stays (resolver above) but as normal generic bound;`bun_api`vestigial crate (schema re-exports here directly);`ast::ToJSError`can stay;`EqlParser`trait stays (js above); dead`options_types→libarchive/zlib`deps; dead`dotenv→bun_dispatch`dep;`sourcemap→semver` edge (semver in core).

### `bun_react_compiler`

**Absorbs**: (unchanged)
**Depends on**: bun_core, bun_ast
**LOC estimate**: ~63,000
**Rationale**: Kept separate **solely** for the `[profile.*.package.bun_react_compiler] opt-level = "s"` override — 63k LOC of Meta's compiler that LTO would otherwise inline at `-O3`, costing ~120KB binary size. `&mut dyn Host` stays: it gives exactly one monomorphization and the crate boundary lets the size override apply.
**Workarounds eliminated**: none (this is the one split we keep on purpose). `JsxImportKind` dup can be replaced with the real `bun_ast` enum now that ast is a direct dep.

### `bun_css`

**Absorbs**: bun_css
**Depends on**: bun_core, bun_sys, bun_ast, bun_macros
**LOC estimate**: ~72,000
**Rationale**: Kept separate for build parallelism — 72k LOC that compiles in parallel with `bun_react_compiler`+`bun_js`, all three feeding `bun_bundler`. Depends on `bun_ast` for `Ref`/`Symbol`/`Log`/`Target` only.
**Workarounds eliminated**: local `MangledProps` type alias (now imports from `bun_js`... no, `bun_js` is parallel — keep the alias, it's 1 line and both crates define it identically from `bun_core` types).

### `bun_js`

**Absorbs**: bun*js_parser, bun_js_printer
**Depends on**: bun_core, bun_sys, bun_ast, bun_react_compiler
**LOC estimate**: ~57,000
**Rationale**: JS/TS parser + printer as one unit. They share `bun_ast` node types; merging lets `RuntimeTranspilerCache`'s `parser_options` field be typed instead of `NonNull<()>`. `MacroContext` becomes `Option<Box<dyn MacroRunner>>` in `ParserOptions` — runtime supplies the impl. `SourceMapHandler`/`RequireOrImportMetaCallback` become `Option<&mut dyn Trait>` (each has one impl in bundler/runtime).
**Workarounds eliminated**: `extern "Rust" \_\_bun_macro*{context_init,deinit,call,get_remap,collect_vm_garbage}`(5 shims) → trait object;`MacroContext { data: \*mut c_void }`+`MacroJSCtx(i64)`opaque;`SourceMapHandler`/`RequireOrImportMetaCallback`manual fn-ptr vtables →`&mut dyn`; dead `js_parser→bun_dispatch`Cargo dep; dead`css_jsc→js_parser` Cargo dep.

### `bun_crypto`

**Absorbs**: bun_boringssl_sys, bun_boringssl, bun_sha_hmac, bun_cares_sys, bun_csrf, bun_s3_signing, bun_dns
**Depends on**: bun_core, bun_sys
**LOC estimate**: ~6,700
**Rationale**: BoringSSL + c-ares + everything built on them. Small enough to be one crate; sits parallel with `bun_ast`/`bun_jsc` in the build graph. `dns::prefetch` becomes `static PREFETCH_HOOK: OnceLock<fn(&str, u16)>` that runtime sets — one cold-path fn-ptr, not `extern "Rust"`.
**Workarounds eliminated**: `extern "Rust" __bun_dns_prefetch` + `extern "C" Bun__addrinfo_registerQuic` → `OnceLock<fn>` hooks; `boringssl`/`boringssl_sys` split; `sha_hmac` as separate crate.

### `bun_jsc`

**Absorbs**: (group-A half of current bun_jsc only) — JSValue, JSGlobalObject, JSObject, JSString, VM, CallFrame, Strong, Weak, Exception, host_fn, array_buffer, cpp, WTF, ZigString, bun_string_jsc, ErrorCode, JSPromise, JSMap, FetchHeaders, AbortSignal, URL, DOMURL, RegularExpression, CachedBytecode (FFI only), codegen, generated
**Depends on**: bun_core, bun_sys, bun_macros
**LOC estimate**: ~17,000
**Rationale**: **THE** load-bearing split. Pure JSC FFI layer with zero knowledge of Transpiler/PackageManager/Resolver/HTTP. Everything above can now depend on `bun_jsc` without cycles, which means `bun_bundler` calls `generate_cached_bytecode` directly, `bun_install` uses `RegularExpression` directly, and the 11 `*_jsc` splits vanish. `error.rs` shrinks to `JsError` only (drops `Resolver`/`Bundler`/`Install`/`Patch` arms — runtime defines the wide error). `ResolveMessage::is_package_path` inlines the 3-line helper. `FromJsEnum for http_types::*` stays (http_types is in `bun_core`).
**Workarounds eliminated**: this crate creates none and now enables eliminating ~30 others downstream. Specifically, by depending on nothing above `bun_sys`, it can be depended on by bundler/install/http/resolver.

### `bun_uws`

**Absorbs**: bun_uws_sys, bun_uws
**Depends on**: bun_core, bun_sys, bun_crypto, bun_macros
**LOC estimate**: ~11,000
**Rationale**: uSockets/uWebSockets FFI + safe wrappers as one crate. The `bun_uws` façade was 90% re-exports. `UpgradedDuplex`/`WindowsNamedPipe` variants are removed from `InternalSocket`; runtime registers them as ordinary `vtable::Handler` impls through the existing C-vtable mechanism (which is a legitimate C ABI, not a Rust workaround). `Method` comes from `bun_core` now, dropping the `http_types` crate edge.
**Workarounds eliminated**: `bun_uws` re-export façade (~1,000 LOC of `pub use`); 25 `extern "C" UpgradedDuplex__*`/`WindowsNamedPipe__*` Rust→Rust shims (replaced by handler registration); `ParentEventLoopHandle` carrier trait (loop stores typed handle now); `uws_sys→http_types` edge.

### `bun_loop`

**Absorbs**: bun*io, bun_event_loop, bun_spawn, bun_patch
**Depends on**: bun_core, bun_sys, bun_uws
**LOC estimate**: ~22,000
**Rationale**: The fd-poll / event-loop / process-spawn layer as one crate. Merging io+event_loop+spawn dissolves the `spawn_sys` split reason and the `io↔event_loop` externs for `Mini`. Upward calls to runtime go through **normal trait objects**: `Task` holds `NonNull<dyn Runnable>` (intrusive, zero-alloc — task structs embed the vtable ptr); `EventLoopTimer` holds `*mut dyn TimerCallback`; `FilePoll`holds`*mut dyn FilePollOwner`; `Process`holds`Option<Box<dyn ProcessExitHandler>>`; `BufferedReader`holds`*const dyn BufferedReaderParent`(trait takes`&self`+ interior mutability for the aliasing case).`EventLoopCtx`becomes`enum { Mini(MiniEventLoop), Js(&'static dyn JsEventLoopHooks) }`— the`Js`impl lives in runtime. Drops`event*loop→dotenv`(env map passed as parameter).
**Workarounds eliminated**:`link_interface! EventLoopCtx[Js,Mini]`+`JsEventLoop[Jsc]`+`BufferedReaderParentLink[13]`+`ProcessExit[12]`→ all become trait objects;`extern "Rust" \_\_bun_js_event_loop_current` + 8×`\_\_bun_spawn_sync\**`+`**bun_fire_timer`+`**bun*js_timer_epoch`+`**bun_stdio_blob_store_new`+`**bun_js_vm_get`+`**bun_get_vm_ctx`+`**bun_run_file_poll`+`\_\_bun_io_pollable_on_ready`/`on_io_error`→ all become trait-object calls;`ErasedJsError`/`JsError`twin enums;`spawn_sys`crate split; 96`task_tag::*`constants +`Task{tag,ptr}`+ 24`EventLoopTimer::Tag`+ 15`PollTag`variants (all become`dyn`); `io/heap.rs`pairing heap stays local;`Source::Any(Box<dyn SourceData>)` stays (legitimate).

### `bun_http`

**Absorbs**: bun_http
**Depends on**: bun_core, bun_sys, bun_ast, bun_crypto, bun_uws, bun_loop
**LOC estimate**: ~18,000
**Rationale**: HTTP/1.1/2/3 client + HTTP thread. Does NOT depend on `bun_jsc` — the WebSocket client (94% of old `http_jsc`) moves to `bun_runtime` where it belongs. `HTTPClientResultCallback` fn-ptr vtable becomes `Box<dyn FnMut(HTTPClientResult)>`. Drops `bun_http→bun_ast` edge by moving `Log`/`Loc` usage to take `&dyn` or by using `bun_ast` which is already a dep here now.
**Workarounds eliminated**: `HTTPClientResultCallback` manual vtable → closure; dead `bun_http→bun_dispatch` Cargo dep.

### `bun_resolver`

**Absorbs**: bun_resolver, bun_router
**Depends on**: bun_core, bun_sys, bun_ast, bun_js
**LOC estimate**: ~20,000
**Rationale**: Module resolution + filesystem router. `AutoInstaller` stays as `Option<&'a dyn AutoInstaller>` (trait defined in `bun_ast`, impl in `bun_install`) — this is a **legitimate** optional-capability trait object, not a workaround. The `extern "Rust"` factory is deleted: `bun_install` constructs the `PackageManager` and hands `&dyn AutoInstaller` to the resolver explicitly (inversion of control, the idi
