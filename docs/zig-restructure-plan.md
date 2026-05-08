# Zig Source Restructure Plan

## Why

We intend to incrementally rewrite Bun's Zig in Rust. The cleanest way to track that is **one `.rs` per `.zig`, sitting next to it**: when `src/http/thread.zig` is ported, `src/http/thread.rs` appears beside it; when the port passes its gates, `thread.zig` is deleted. Progress becomes a `find`:

```sh
find src -name '*.zig' | wc -l    # remaining work
```

For that to work, `src/` must already be shaped like a Rust workspace: every file under a subject-area directory that can later receive a `Cargo.toml`, with acyclic dependencies between areas. Today `src/` has ~100 loose top-level `.zig` files, `src/bun.js/` mixes JSC primitives with runtime APIs with C++ bindings, `src/deps/<lib>.zig` files mix raw `extern fn` decls with high-level wrappers, and several would-be areas have hard import cycles. This PR fixes the shape — Zig only.

## Use `git mv` — read this before touching anything

**Every file relocation below MUST use `git mv`**, never plain `mv`, never delete-and-recreate. Git's rename detection is similarity-based and breaks when a file is moved and edited in the same commit; `git mv` records the rename so `git log --follow` and `git blame` survive.

For files that are **content-split** (the `_sys`/wrapper splits and `*_jsc/` extractions in §2), do it in **two commits**:

1. `git mv old/path.zig new/path.zig` — pure rename, zero content change. Commit.
2. Edit `new/path.zig` to cut the split-out portion into the sibling file. Commit.

This keeps blame on the larger half. Never create the new file and delete the old in one step.

```sh
git mv src/deps/uws.zig src/uws/uws.zig                                # commit 1
# edit src/uws/uws.zig, create src/uws_sys/uws_sys.zig with externs    # commit 2
```

`@import` path fixups edit the moved file in place — do not regenerate.

## Tracking progress

After this PR, porting a file means writing `foo.rs` next to `foo.zig`, adding `mod foo;` to the area's `lib.rs`, and deleting `foo.zig` when the port passes its gates. The filesystem is the ledger:

```sh
find src -name '*.zig' -not -path 'src/codegen/*' | wc -l    # files remaining
```

No `mod.rs` files — Rust 2018 style: a subdirectory `h2/` has its modules declared in sibling `h2.rs`. Each `src/<area>/` gets exactly one `lib.rs` (the crate root, sibling of `<area>.zig`) when its first `.rs` lands.

---

**Scope:** One PR (a stack of commits per the two-commit rule above). Zig-only file reorganization of `src/`. No behavior change, no public-API change, no Rust, no Cargo, no new build system.

**Kinds of edits permitted in the PR:**

1. `git mv` of whole files into new directories.
2. `@import("...")` path fixups (relative paths and `bun.zig` re-export targets).
3. **Content splits** where listed below — moving a named function/struct/extern block out of a file into a sibling file in a different directory (e.g. `extern fn` decls → `<lib>_sys/`, `toJS`/`fromJS` helpers → `<lib>_jsc/`). The moved code is byte-identical; only its file location changes.
4. Build-script path-literal updates (`scripts/glob-sources.ts`, `scripts/build/{codegen,bun,unified}.ts`, `build.zig`).

**Not permitted in this PR:** logic changes, signature changes, new abstractions, deleting dead code, and Shape-A opaque-owner refactors (changing a typed `TaggedPointerUnion` field to `u64` and relocating dispatch). Those land per-area at Rust-port time; in this PR Zig keeps the closed unions (lazy compilation tolerates the cycle).

---

## 1. Target `src/` layout

Directories are grouped by dependency tier, leaf → root. A directory may only `@import` from its own tier or a lower tier. Zig's lazy compilation tolerates the few remaining upward edges noted inline; each resolves at Rust-port time with zero perf cost (opaque `u64` + `#[repr(transparent)]` newtype wrapper in the consumer — same 8 bytes, same jump-table, no indirect call).

Every directory's eventual `[package] name` is `bun_<dir>` (e.g. `src/sys/` → crate `bun_sys`). Directories `bun_core/` and `bun_alloc/` are pre-prefixed because `core`/`alloc` are Rust sysroot crates. Every area-root file is `src/<area>/<area>.zig` (no `mod.zig`); its Rust sibling will be `lib.rs`.

### Tier 0 — pure leaves (std-only, or std + `_sys` C ABI)

| dir                     | purpose                                                                                                                                                                                                                                                  | notes                                                                                                                                                                                                                                                                                                                         |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/meta/`             | comptime type introspection (`ReturnOf`, `Item`, traits, bit ops, `TaggedUnion`), `tagged_ptr_union!`/`container_of!` helpers                                                                                                                            | inline `std.mem.eql` at `meta.zig:78` to drop `bun.strings` ref                                                                                                                                                                                                                                                               |
| `src/wyhash/`           | pinned Wyhash v1.1                                                                                                                                                                                                                                       | already falls back to `std.debug.assert` (`wyhash.zig:4`)                                                                                                                                                                                                                                                                     |
| `src/deps/uucode/`      | vendored Unicode property lib (build-time only)                                                                                                                                                                                                          | unchanged; already a standalone Zig package                                                                                                                                                                                                                                                                                   |
| `src/unicode/`          | build-time grapheme-table generator                                                                                                                                                                                                                      | unchanged; only consumer of `uucode`                                                                                                                                                                                                                                                                                          |
| `src/tcc_sys/`          | TinyCC FFI (22 extern fn)                                                                                                                                                                                                                                | from `src/deps/tcc.zig`                                                                                                                                                                                                                                                                                                       |
| `src/zlib_sys/`         | zlib C ABI structs + extern fn                                                                                                                                                                                                                           | from `src/deps/zlib.{posix,win32,shared}.zig` + extern block of `src/zlib.zig:6-11`                                                                                                                                                                                                                                           |
| `src/brotli_sys/`       | brotli C ABI (31 extern fn)                                                                                                                                                                                                                              | from `src/deps/brotli_c.zig`; replace `bun.sliceTo` (`:81`) with `std.mem.sliceTo`                                                                                                                                                                                                                                            |
| `src/libdeflate_sys/`   | libdeflate C ABI (21 extern fn) + thin wrappers                                                                                                                                                                                                          | from `src/deps/libdeflate.zig`                                                                                                                                                                                                                                                                                                |
| `src/highway_sys/`      | Google Highway SIMD extern decls                                                                                                                                                                                                                         | extern block of `src/highway.zig:1-65,231`                                                                                                                                                                                                                                                                                    |
| `src/highway/`          | safe wrappers over `highway_sys`                                                                                                                                                                                                                         | remainder of `src/highway.zig`; delete dead `bun.strings` import (`:307`)                                                                                                                                                                                                                                                     |
| `src/simdutf_sys/`      | simdutf C ABI                                                                                                                                                                                                                                            | from `src/bun.js/bindings/bun-simdutf.zig` (412 LOC, no JSC types)                                                                                                                                                                                                                                                            |
| `src/mimalloc_sys/`     | `mi_*` extern fns                                                                                                                                                                                                                                        | extern block of `src/allocators/mimalloc.zig`                                                                                                                                                                                                                                                                                 |
| `src/platform/`         | raw OS-specific libc/syscall externs                                                                                                                                                                                                                     | from `src/darwin.zig` + `src/linux.zig` (see §2)                                                                                                                                                                                                                                                                              |
| `src/lolhtml_sys/`      | lol-html C ABI (75 extern fn)                                                                                                                                                                                                                            | from `src/deps/lol-html.zig` minus `HTMLString.toString/toJS` (`:603-616`)                                                                                                                                                                                                                                                    |
| `src/windows_sys/`      | Win32 extern fn + types/constants (49 extern fn)                                                                                                                                                                                                         | from `src/windows.zig:90-153,2980-3103`                                                                                                                                                                                                                                                                                       |
| `src/libuv_sys/`        | libuv C ABI (302 extern fn, structs, `UV_*` constants)                                                                                                                                                                                                   | from `src/deps/libuv.zig`; depends `windows_sys`                                                                                                                                                                                                                                                                              |
| `src/boringssl_sys/`    | BoringSSL translate-c (2234 extern fn)                                                                                                                                                                                                                   | from `src/deps/boringssl.translated.zig`                                                                                                                                                                                                                                                                                      |
| `src/cares_sys/`        | c-ares C ABI (60 extern fn) + reply structs + `Error`                                                                                                                                                                                                    | from `src/deps/c_ares.zig`; depends `libuv_sys`                                                                                                                                                                                                                                                                               |
| `src/picohttp_sys/`     | picohttpparser C ABI (5 extern fn)                                                                                                                                                                                                                       | from `src/deps/picohttpparser.zig`                                                                                                                                                                                                                                                                                            |
| `src/uws_sys/`          | uSockets/uWebSockets C ABI (309 extern fn)                                                                                                                                                                                                               | extern blocks from `src/deps/uws/*.zig`; depends `boringssl_sys`                                                                                                                                                                                                                                                              |
| `src/libarchive_sys/`   | libarchive C ABI (108 extern fn)                                                                                                                                                                                                                         | from `src/libarchive/libarchive-bindings.zig`                                                                                                                                                                                                                                                                                 |
| `src/string_sys/`       | `BunString__*`/`WTFStringImpl__*` extern fns, `icu_hasBinaryProperty`, `Bun__ANSI__next`, `memmem`                                                                                                                                                       | split from `src/string/`                                                                                                                                                                                                                                                                                                      |
| `src/install_types/`    | `NodeLinker`, `Npm.Registry`, `PnpmMatcher`, `SemverString`, `ExternalString`, `WorkspaceMap` — pure data types                                                                                                                                          | extracted from `src/install/` + `src/semver/` so `semver`/`ini`/`options_types`/`resolver` import without cycling; ~500 LOC, no logic                                                                                                                                                                                         |
| `src/options_types/`    | `api/schema.zig` (peechy `Reader`/`Writer` + `TransformOptions`/`BunInstall`), `Command.{Context,Tag}`, `DebugOptions`/`TestOptions`/`BundlerOptions`/`RuntimeOptions`, `Arguments`, `options.{Format,Target,Loader}` enums, `debug_flags`, `start_time` | merged `options_types` + `options_types` + plain enums from `src/options.zig`. `Context` has no `*Transpiler` field (see `cli.zig` `ContextData`) — depends only on `logger`, `string`, `bun_core`, `install_types`, `collections`. Every back-edge that wanted `Command.Context` or `api.TransformOptions` imports from here |
| `src/resolve_builtins/` | `HardcodedModule` enum + alias map                                                                                                                                                                                                                       | from `src/bun.js/ModuleLoader/HardcodedModule.zig`; pure string→enum, zero JSC refs                                                                                                                                                                                                                                           |

### Tier 1 — core utilities

| dir                  | purpose                                                                                                                                                                                                                                       | depends on                                                                                                                                                                                                                        |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/safety/`        | ASan wrappers, `ThreadLock`, `CriticalSection`, `CheckedAllocator`; absorbs `hasPtr` (`safety/alloc.zig:25-36` — calls only `mimalloc_sys::mi_is_in_heap_region`)                                                                             | `meta`, `mimalloc_sys`                                                                                                                                                                                                            |
| `src/collections/`   | `BabyList`, `MultiArrayList`, `BitSet`, `HiveArray`, `BoundedArray`, `ComptimeStringMap`, `LinearFifo`, `ObjectPool`, `IdentityContext`, `StaticHashMap`                                                                                      | `meta`, `safety` — `BabyList(u8)` string helpers (`baby_list.zig:349-475`) move to `src/string/baby_list_ext.zig`; css helpers (`:456-475`) move to `src/css/baby_list_ext.zig`                                                   |
| `src/threading/`     | `Futex`, `Mutex`, `Condition`, `WaitGroup`, `Channel`, `UnboundedQueue`, `ThreadPool`, `WorkPool`                                                                                                                                             | `safety`, `collections` — in Zig: `ThreadPool` idle/spawn hooks (`ThreadPool.zig:554-707`) keep direct `output`/`allocators` calls (cycle tolerated). At port time: hooks become `Option<fn()>` set by pool constructor           |
| `src/bun_alloc/`     | mimalloc `Allocator` impl, `MimallocArena`, `LinuxMemFdAllocator`, `Owned`/`Shared`/`RefCount`/`Cow`/`TaggedPointer`/`WeakPtr` (absorbs `src/ptr/` — smart pointers and the allocator they free into are one concern)                         | `meta`, `safety`, `threading`, `mimalloc_sys`                                                                                                                                                                                     |
| `src/string/`        | UTF-8/16/Latin-1, grapheme, `MutableString`, `StringBuilder`, `StringJoiner`, `SmolStr`, `HashedString`, `PathString`, WTF mirror; absorbs `quoteForJSON`/`writePreQuotedString`/`writeJSONString` (sunk from `js_printer`)                   | `bun_alloc`, `collections`, `highway`, `simdutf_sys`, `string_sys`                                                                                                                                                                |
| `src/bun_core/`      | process globals: `Output`/`Progress`/`tty`, `Global` version constants + exit/atexit, `env.zig` build-time constants, `feature_flags`, `env_var`, `timespec`, `util.zig`, `result.zig` (consolidates `output`+`Global`+`env`+`feature_flags`) | `string`, `bun_alloc`, `threading`, `platform` — in Zig: `Global.zig` keeps direct `bun.jsc.Node.FSEvents`/`bun.ast` cleanup calls (cycle tolerated). At port time: those become `Option<fn()>` cleanup hooks set by their owners |
| `src/perf/`          | Tracy shim, OSLog signposts, `trace_marker`, TSC reader, `SystemTimer`                                                                                                                                                                        | `bun_core` (for `timespec`), `platform`                                                                                                                                                                                           |
| `src/analytics/`     | feature-usage counters, OS/kernel detection                                                                                                                                                                                                   | `semver`, `resolve_builtins` (imports `HardcodedModule` enum from there, replacing `analytics.zig:31` `jsc.*` ref)                                                                                                                |
| `src/semver/`        | `Version`/`Range`/`Query`                                                                                                                                                                                                                     | `string`, `wyhash`, `collections`, `install_types` (for `SemverString`/`ExternalString`)                                                                                                                                          |
| `src/options_types/` | peechy binary wire schema (`Reader`/`Writer` + option structs)                                                                                                                                                                                | `string`, `collections`, `install_types` (for `NodeLinker`/`PnpmMatcher`; `schema.zig:3069-3079` re-points there)                                                                                                                 |
| `src/errno/`         | `SystemErrno`/`E`/`UV_E`/`S` enums, `getErrno`; absorbs Win32/NT/UV translators                                                                                                                                                               | `windows_sys`, `libuv_sys`                                                                                                                                                                                                        |

### Tier 2 — platform / system

| dir                  | purpose                                                                                                                                                                                                                                                                                                         | depends on                                                                                                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sys/`           | cross-platform syscalls, `FD`, `Error`, `File`, `Maybe`, `tmp`/`copy_file`/`dir`/`walker`/`SignalCode`; absorbs `src/windows/` as `sys/windows/` (errno translation + watcher glue + `env.zig`), `RWFFlagSupport`/`ioctl_ficlone` (`linux.zig:25-73`), libuv `Maybe`-wrappers (`libuv.zig:1327-1544,2434-2446`) | `errno`, `string`, `bun_core`, `windows_sys`, `libuv_sys`, `platform`, `paths` — in Zig: keeps direct `bun.Output` debug-logging calls (cycle tolerated). At port time: `static DEBUG_LOG: AtomicPtr<fn(&str)>` set by `bun_core/` (release: dead-stripped)                                                                         |
| `src/paths/`         | `PathBuffer`/`WPathBuffer`/`OSPathBuffer`, buffer pool, `Path`/`AbsPath`/`RelPath`/`EnvPath`; absorbs `resolve_path.zig` join/relative algorithms (2138 LOC)                                                                                                                                                    | `string`, `windows_sys`                                                                                                                                                                                                                                                                                                             |
| `src/crash_handler/` | signal/SEH handler, panic, tracestring encoder, OOM hook, `CPUFeatures`                                                                                                                                                                                                                                         | `string`, `threading`, `analytics`, `perf`, `bun_core`, `windows_sys` — in Zig: keeps closed `Action` union (`crash_handler.zig:112-148`) referencing `cli`/`bundler`/`ast` (cycle tolerated). At port time: `action` field becomes opaque `u64`; typed formatter via `static FORMAT_ACTION: fn(u64, &mut Formatter)` set by `cli/` |
| `src/clap/`          | CLI argument parsing (vendored zig-clap fork)                                                                                                                                                                                                                                                                   | `string`                                                                                                                                                                                                                                                                                                                            |

### Tier 3 — I/O, crypto, compression, async primitives

| dir               | purpose                                                                                                                                                                                | depends on                                                                                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/boringssl/`  | `load()`, mimalloc memory hooks, `checkServerIdentity`, `canonicalizeIP`, `SSLConfig`, `ssl_wrapper`, `EVP`/`HMAC` digest wrappers (~280 LOC sunk from `runtime/crypto/`), `x509_util` | `boringssl_sys`, `string`, `cares_sys`, `bun_alloc`                                                                                                                                                                                                                                                                                                    |
| `src/sha_hmac/`   | SHA/MD/EVP digest + HMAC; absorbs `EVP.Algorithm` enum                                                                                                                                 | `boringssl`                                                                                                                                                                                                                                                                                                                                            |
| `src/csrf/`       | HMAC-signed CSRF token generate/verify (pure half)                                                                                                                                     | `sha_hmac`, `boringssl`, `base64`, `string`                                                                                                                                                                                                                                                                                                            |
| `src/s3_signing/` | SigV4 signer, credentials, ACL, storage-class enums                                                                                                                                    | `sha_hmac`, `boringssl`, `string`, `url`                                                                                                                                                                                                                                                                                                               |
| `src/zlib/`       | `ZlibReaderArrayList`, `ZlibCompressorArrayList`, `ZlibAllocator`                                                                                                                      | `zlib_sys`, `bun_alloc`                                                                                                                                                                                                                                                                                                                                |
| `src/brotli/`     | `BrotliReaderArrayList`, `BrotliCompressionStream`                                                                                                                                     | `brotli_sys`, `bun_alloc`                                                                                                                                                                                                                                                                                                                              |
| `src/zstd/`       | one-shot + streaming zstd                                                                                                                                                              | `platform` (translate-c headers)                                                                                                                                                                                                                                                                                                                       |
| `src/libarchive/` | `BufferReadStream`, `extractToDir`, `Plucker`                                                                                                                                          | `libarchive_sys`, `sys`, `string`, `paths`                                                                                                                                                                                                                                                                                                             |
| `src/base64/`     | base64 encode/decode (WHATWG + URL-safe)                                                                                                                                               | `simdutf_sys`, `collections`                                                                                                                                                                                                                                                                                                                           |
| `src/picohttp/`   | `Header`/`Request`/`Response`/`Headers` wrapper                                                                                                                                        | `picohttp_sys`, `string` — replace `bun.js_printer.writeJSONString` (`picohttp.zig:146`) with `bun.string.quote.writeJSONString`                                                                                                                                                                                                                       |
| `src/uws/`        | `Loop`, `Socket`, `App`/`Request`/`Response`, `WebSocket`, UDP, QUIC/H3 wrappers                                                                                                       | `uws_sys`, `boringssl`, `sys`, `libuv_sys` — `handlers.zig`/`dispatch.zig`/`UpgradedDuplex.zig`/`WindowsNamedPipe.zig`/`us_socket_t.writeJS`/`WebSocket.getTopicsAsJSArray` move to `runtime/socket/`. In Zig: `InternalLoopData.jsc_vm` (`:27-56`) keeps typed field (cycle tolerated). At port time: field becomes `?*anyopaque`, accessor in `jsc/` |
| `src/io/`         | platform polling (`io_{linux,darwin,windows}.zig`), `PipeReader`/`PipeWriter`, `Pollable`, `MaxBuf`                                                                                    | `sys`, `uws_sys`, `libuv_sys` — in Zig: keeps closed `Pollable.Tag` (`io.zig:396-402`)/`MaxBuf` owner unions (cycle tolerated). At port time: owner becomes opaque `u64`; typed dispatch via `#[repr(transparent)]` newtype in `runtime/`                                                                                                              |
| `src/async/`      | `KeepAlive`, `posix_event_loop`/`windows_event_loop` loop-ref glue, `FilePoll`                                                                                                         | `sys`, `io`, `uws` — in Zig: keeps closed `FilePoll.Owner` union (`posix_event_loop.zig:169-197`) (cycle tolerated). At port time: owner becomes opaque `u64`; `install/` defines 3-variant `InstallPollOwner`, `runtime/` defines full `RuntimePollOwner` newtype wrappers                                                                            |
| `src/event_loop/` | `Task`, `ConcurrentTask` (16B intrusive node), `EventLoopTimer`, `TimerHeap`, `AutoFlusher`, `DeferredTaskQueue`, `MiniEventLoop`, `AnyEventLoop`, `WorkTask`, `ManagedTask`           | `threading`, `async`, `collections`, `bun_alloc` — in Zig: keeps closed 95-variant `Task` union and 22-variant `EventLoopTimer.Tag` (cycle tolerated). At port time: stored as opaque `u64`; consumer crate defines `tagged_ptr_union!` + `#[repr(transparent)]` newtype + `match` dispatch — same 8B, same jump-table, zero indirect calls            |

### Tier 4 — parsers, formats, diagnostics

| dir                     | purpose                                                                                                                                                                                                                                                                                                                                                       | depends on                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/logger/`           | `Loc`/`Range`/`Msg`/`Log`/`Source`/`Data`; absorbs `File.toSource` from `sys`                                                                                                                                                                                                                                                                                 | `string`, `collections`, `sys`                                                                                                                                                                                        |
| `src/url/`              | `URL`, `QueryStringMap`, `PercentEncoding`, `Scanner`, `FormData` multipart parser, `Param` (sunk from `router`)                                                                                                                                                                                                                                              | `string`, `collections`, `semver`, `options_types`, `paths`                                                                                                                                                           |
| `src/dns/`              | `GetAddrInfo` option modeling, `toLibC`/`toCAres`, `addressToString`                                                                                                                                                                                                                                                                                          | `cares_sys`, `string`                                                                                                                                                                                                 |
| `src/glob/`             | pattern matcher + filesystem walker                                                                                                                                                                                                                                                                                                                           | `string`, `sys`, `paths`, `collections`                                                                                                                                                                               |
| `src/which/`            | cross-platform `$PATH` executable lookup                                                                                                                                                                                                                                                                                                                      | `paths`, `string`, `sys`                                                                                                                                                                                              |
| `src/patch/`            | unified-diff parser + filesystem applier + git-diff generator                                                                                                                                                                                                                                                                                                 | `sys`, `string`, `paths`, `collections` — replace `bun.api.node.fs.NodeFS.mkdirRecursive` (`patch.zig:80,97`) with `bun.sys.mkdirRecursive`                                                                           |
| `src/ini/`              | generic INI parser → `bun.ast.Expr`                                                                                                                                                                                                                                                                                                                           | `string`, `logger`, `js_parser`                                                                                                                                                                                       |
| `src/watcher/`          | inotify/kqueue/ReadDirectoryChangesW filesystem watcher                                                                                                                                                                                                                                                                                                       | `sys`, `string`, `paths`, `threading` — in Zig: `WatchItem.{loader,package_json}` (`Watcher.zig:218,223`) keep typed fields (cycle tolerated). At port time: become opaque `u32`/`?*anyopaque`, consumer reinterprets |
| `src/md/`               | CommonMark/GFM parser, HTML + ANSI renderers                                                                                                                                                                                                                                                                                                                  | `string`, `base64`, `collections`, `sys`, `paths`, `url`                                                                                                                                                              |
| `src/sourcemap/`        | VLQ, `LineOffsetTable`, `Mapping`, `Chunk`, `ParsedSourceMap`, `InternalSourceMap` codec                                                                                                                                                                                                                                                                      | `string`, `collections`, `bun_alloc`, `logger`, `semver`, `base64`, `sys`, `url` — `Chunk.zig:81` re-points to `bun.string.quote.quoteForJSON`                                                                        |
| `src/css/`              | lightningcss-port parser/minifier/printer; absorbs `baby_list` css helpers                                                                                                                                                                                                                                                                                    | `string`, `collections`, `meta`, `logger`, `base64`, `wyhash`, `paths`, `js_parser` — `css_parser.zig:1` `SrcIndex` re-points to `bun.js_parser.Index`; `:92` `Maybe` re-points to `bun.sys.Maybe`                    |
| `src/valkey/`           | RESP protocol parser + `ValkeyCommand` encoding                                                                                                                                                                                                                                                                                                               | `string`, `collections`                                                                                                                                                                                               |
| `src/js_parser/`        | lexer + parser + AST (`Expr`/`Stmt`/`E`/`S`/`G`), `NewStore`, `Ref`/`Index`/`MangledProps`, `runtime.zig` (printer-runtime intrinsics) — merge of `src/ast/` + `src/js_parser.zig` + `src/js_lexer.zig` + `src/js_lexer/` (mutually entangled: `ast/P.zig` ↔ `js_parser.zig`; lexer stores `js_ast.Span`). `Macro.zig` + `toJS()` extract to `js_parser_jsc/` | `string`, `logger`, `collections`, `bun_alloc`, `bun_core`, `sourcemap`                                                                                                                                               |
| `src/js_printer/`       | serialize `js_ast` → JS/JSON text; symbol renamer                                                                                                                                                                                                                                                                                                             | `js_parser`, `sourcemap`, `logger`, `string` — `quoteForJSON`/`writePreQuotedString`/`writeJSONString` sink to `string/quote.zig`; `mangled_props` (`js_printer.zig:431`) re-points to `bun.js_parser.MangledProps`   |
| `src/interchange/`      | JSON/JSON5/TOML/YAML → `bun.ast.Expr`                                                                                                                                                                                                                                                                                                                         | `logger`, `string`, `collections`, `js_parser`, `js_printer`                                                                                                                                                          |
| `src/exe_format/`       | ELF/Mach-O/PE parsers + writers                                                                                                                                                                                                                                                                                                                               | `string`, `sys`                                                                                                                                                                                                       |
| `src/standalone_graph/` | `StandaloneModuleGraph` reader (`base_path`/`get`/`find`/`SerializedSourceMap`)                                                                                                                                                                                                                                                                               | `sourcemap`, `string`, `sys`                                                                                                                                                                                          |

### Tier 5 — networking, resolution, env loading

| dir                 | purpose                                                                              | depends on                                                                                                                                               |
| ------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/http_types/`   | `Method`, `MimeType`, `Encoding`, `ETag`, `URLPath`, `Fetch*` enums                  | `string`                                                                                                                                                 |
| `src/http/`         | `AsyncHTTP`/`HTTPThread` core, H2/H3 client, proxy tunnel; absorbs `lshpack.zig`     | `http_types`, `picohttp`, `uws`, `boringssl`, `brotli`, `zlib`, `zstd`, `libdeflate_sys`, `url`, `string`, `threading`, `event_loop`                     |
| `src/router/`       | Next.js-compatible filesystem router; absorbs `PathnameScanner`/`CombinedScanner`    | `url`, `http_types`, `logger`, `paths`, `sys`, `glob`                                                                                                    |
| `src/resolver/`     | module resolution (minus `resolve_path.zig` → `paths`); `fs.zig`+`fs/` absorbed here | `paths`, `js_parser`, `logger`, `sys`, `url`, `install_types`, `resolve_builtins`, `options_types` — `WorkspaceMap` lookup imports from `install_types/` |
| `src/dotenv/`       | `.env` file loader (`env_loader.zig`)                                                | `sys`, `logger`, `url`, `which`, `js_parser`, `s3_signing`, `options_types`, `analytics`                                                                 |
| `src/shell_parser/` | `braces.zig` + shell lexer/AST                                                       | `string`, `logger`                                                                                                                                       |

### Tier 6 — application subsystems

| dir                  | purpose                                                                                                                                                                                                                                                                                                               | depends on                                                                                                                                                                                                                                                                                                                    |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/install/`       | `PackageManager`, lockfile, `NetworkTask`, tarball extract, `npmrc` (absorbed from `ini.zig:720-1473`), `npm_registry_parser` (absorbed from `options_types`), `semver_ext` (Lockfile-taking `Buf` methods)                                                                                                           | `install_types`, `semver`, `ini`, `http`, `libarchive`, `libdeflate_sys`, `zlib`, `event_loop`, `async`, `threading`, `sys`, `resolver`, `options_types`, `interchange` — at port time: defines `InstallPollOwner`/`InstallTask` newtypes wrapping `async::FilePoll`/`event_loop::Task` with its 3/5-variant `match` dispatch |
| `src/bundler/`       | `BundleV2`, `Graph`, `LinkerContext`, `ParseTask`; absorbs `transpiler.zig`+`linker.zig`, `options.zig`/`defines*.zig`/`import_record.zig`/`cache.zig` (transpiler config), `OutputFile.zig`, `HTMLScanner.zig`, `compile_target.zig` + `StandaloneModuleGraph.toExecutable/toBytes`, `analyze_transpiled_module.zig` | `js_parser`, `js_printer`, `css`, `sourcemap`, `resolver`, `logger`, `threading`, `event_loop`, `sys`, `options_types`, `exe_format`, `standalone_graph`, `interchange`                                                                                                                                                       |
| `src/sql/`           | postgres/mysql wire protocol, connection state machines                                                                                                                                                                                                                                                               | `string`, `boringssl`, `uws`, `event_loop`, `collections`                                                                                                                                                                                                                                                                     |
| `src/jsc/`           | `JSValue`/`JSRef`/`Strong`/`CallFrame`/`host_fn`/`MarkedArgumentBuffer`/`conv`, all `src/bun.js/bindings/*.zig` opaque wrappers, `EventLoop` (VM-owning), `VirtualMachine`, `ModuleLoader`, `ConsoleObject`; `bindings/*.{cpp,h}` stay co-located                                                                     | `string`, `bun_core`, `event_loop`, `bun_alloc`, `resolve_builtins`                                                                                                                                                                                                                                                           |
| `src/semver_jsc/`    | `SemverObject.zig`, `String.toJS`                                                                                                                                                                                                                                                                                     | `semver`, `jsc`                                                                                                                                                                                                                                                                                                               |
| `src/sys_jsc/`       | `FD.toJS/fromJS`, `Error.toJS/toSystemError`, `TestingAPIs`                                                                                                                                                                                                                                                           | `sys`, `jsc`                                                                                                                                                                                                                                                                                                                  |
| `src/logger_jsc/`    | `toJS`/`fromJS`/`toJSArray`/`toJSAggregateError`/`Level.fromJS`                                                                                                                                                                                                                                                       | `logger`, `jsc`                                                                                                                                                                                                                                                                                                               |
| `src/url_jsc/`       | `URL.fromJS`, `FormData.toJS`/`AsyncFormData`/`jsFunctionFromMultipartData`                                                                                                                                                                                                                                           | `url`, `jsc`                                                                                                                                                                                                                                                                                                                  |
| `src/patch_jsc/`     | `TestingAPIs` bindings                                                                                                                                                                                                                                                                                                | `patch`, `jsc`                                                                                                                                                                                                                                                                                                                |
| `src/sourcemap_jsc/` | `JSSourceMap`, `CodeCoverage`, `SourceProviderMap`/`BakeSourceProvider` opaques                                                                                                                                                                                                                                       | `sourcemap`, `jsc`                                                                                                                                                                                                                                                                                                            |
| `src/css_jsc/`       | `css_internals.zig`, `values/color_js.zig`, `error.zig:toErrorInstance`                                                                                                                                                                                                                                               | `css`, `jsc`                                                                                                                                                                                                                                                                                                                  |
| `src/js_parser_jsc/` | `Macro.zig`, `Expr.toJS()`/`Stmt.toJS()`                                                                                                                                                                                                                                                                              | `js_parser`, `jsc`                                                                                                                                                                                                                                                                                                            |
| `src/http_jsc/`      | `websocket_client.*`, `CppWebSocket`, `Headers.toFetchHeaders`, `Method.toJS`, H2/H3 `liveCounts`                                                                                                                                                                                                                     | `http`, `jsc`                                                                                                                                                                                                                                                                                                                 |
| `src/install_jsc/`   | `install_binding`, `security_scanner`, `npm.jsFunction*`, `UpdateRequest.fromJS`, `jsParseLockfile`                                                                                                                                                                                                                   | `install`, `jsc`                                                                                                                                                                                                                                                                                                              |
| `src/bundler_jsc/`   | `JSBundleCompletionTask`, `JSBundler.{Plugin,Load,Resolve}` glue, `hot_reloader` Watcher, `Bun__setupLazyMetafile` extern                                                                                                                                                                                             | `bundler`, `jsc`                                                                                                                                                                                                                                                                                                              |
| `src/sql_jsc/`       | `JSMySQLConnection`, `JSPostgresConnection`, query bindings                                                                                                                                                                                                                                                           | `sql`, `jsc`                                                                                                                                                                                                                                                                                                                  |

### Tier 7 — apex (binary + monolithic runtime)

| dir                | purpose                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | depends on                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/runtime/`     | `.classes.ts` impls: `api/` (glob, hash, cron, archive, s3 client, …), `socket/` (NewSocket, Handlers, Listener, udp, uws_handlers/dispatch absorbed from `uws/`), `server/` (Server, RequestContext, ServerWebSocket, NodeHTTPResponse), `webcore/` (Request, Response, Body, Blob, streams, FetchTasklet, s3 Blob half), `node/` (node_fs, node_net, node_crypto, …), `crypto/` (JS glue; pure EVP/HMAC sunk to `boringssl/`), `dns_jsc/`, `valkey_jsc/`, `ffi/`, `webview/` | everything in tiers 0-6 — at port time: defines `RuntimePollOwner`/`RuntimePollable`/`RuntimeTask` (95 variants)/`RuntimeTimer` (22 variants) `tagged_ptr_union!`s; wraps `async::FilePoll`/`io::Pollable`/`event_loop::Task`/`event_loop::EventLoopTimer` with `#[repr(transparent)]` newtypes + `match` dispatch + `container_of!` |
| `src/shell/`       | interpreter + builtins + subproc; depends `runtime/` for spawn/FilePoll dispatch                                                                                                                                                                                                                                                                                                                                                                                               | `shell_parser`, `runtime`, `sys`, `event_loop`                                                                                                                                                                                                                                                                                       |
| `src/napi/`        | N-API host fns (256 extern fn to `napi*.cpp`)                                                                                                                                                                                                                                                                                                                                                                                                                                  | `runtime`, `jsc`                                                                                                                                                                                                                                                                                                                     |
| `src/test_runner/` | `bun:test`, expect, snapshots, `FakeTimers`                                                                                                                                                                                                                                                                                                                                                                                                                                    | `runtime`, `options_types`, `jsc`                                                                                                                                                                                                                                                                                                    |
| `src/bake/`        | SSR/HMR dev server                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `bundler`, `runtime`, `sourcemap_jsc`                                                                                                                                                                                                                                                                                                |
| `src/cli/`         | command dispatcher, `bunfig.zig`, `repl/`, `create/`, `init/` assets, `open.zig`, `which_npm_client.zig`; registers `crash_handler::FORMAT_ACTION`                                                                                                                                                                                                                                                                                                                             | `options_types`, everything in tiers 0-6, `runtime`, `bundler_jsc`, `install_jsc`, `test_runner`, `shell`, `bake`                                                                                                                                                                                                                    |

`src/bun.zig`, `src/main.zig`, `src/main_test.zig`, `src/main_wasm.zig`, `src/unit_test.zig`, `src/jsc_stub.zig`, `src/bun.js.zig`, `src/workaround_missing_symbols.zig` remain at the top level.

---

## 2. Per-directory file mapping

Legend: **mv** = `git mv` whole file. **split** = move named declarations into a new file (rest stays). **absorb** = move file into a directory owned by a _different_ viable target.

### `src/meta/`

| current                     | new                         | op                                                                         |
| --------------------------- | --------------------------- | -------------------------------------------------------------------------- |
| `src/meta.zig`              | `src/meta/meta.zig`         | mv; replace `bun.strings.eqlAnyComptime` (`:78`) with `std.mem.eql` inline |
| `src/trait.zig`             | `src/meta/trait.zig`        | mv                                                                         |
| `src/bits.zig`              | `src/meta/bits.zig`         | mv                                                                         |
| `src/meta/tagged_union.zig` | `src/meta/tagged_union.zig` | unchanged                                                                  |

### `src/wyhash/`

| current          | new                     | op  |
| ---------------- | ----------------------- | --- |
| `src/wyhash.zig` | `src/wyhash/wyhash.zig` | mv  |

### `src/tcc_sys/`

| current            | new                   | op  |
| ------------------ | --------------------- | --- |
| `src/deps/tcc.zig` | `src/tcc_sys/tcc.zig` | mv  |

### `src/zlib_sys/` + `src/zlib/`

| current                                    | new                        | op    |
| ------------------------------------------ | -------------------------- | ----- |
| `src/deps/zlib.posix.zig`                  | `src/zlib_sys/posix.zig`   | mv    |
| `src/deps/zlib.win32.zig`                  | `src/zlib_sys/win32.zig`   | mv    |
| `src/deps/zlib.shared.zig`                 | `src/zlib_sys/shared.zig`  | mv    |
| `src/zlib.zig` `:6-11,128-144` (extern fn) | `src/zlib_sys/externs.zig` | split |
| `src/zlib.zig` (remainder)                 | `src/zlib/zlib.zig`        | mv    |

### `src/brotli_sys/` + `src/brotli/`

| current                 | new                           | op                                          |
| ----------------------- | ----------------------------- | ------------------------------------------- |
| `src/deps/brotli_c.zig` | `src/brotli_sys/brotli_c.zig` | mv; `:81` `bun.sliceTo` → `std.mem.sliceTo` |
| `src/brotli.zig`        | `src/brotli/brotli.zig`       | mv                                          |

### `src/libdeflate_sys/`

| current                   | new                                 | op  |
| ------------------------- | ----------------------------------- | --- |
| `src/deps/libdeflate.zig` | `src/libdeflate_sys/libdeflate.zig` | mv  |

### `src/highway_sys/` + `src/highway/`

| current                                      | new                                   | op                                                      |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------------- |
| `src/highway.zig` `:1-65,231` (12 extern fn) | `src/highway_sys/externs.zig`         | split                                                   |
| `src/highway.zig` (remainder)                | `src/highway/highway.zig`             | mv; delete dead `const strings = bun.strings;` (`:307`) |
| `src/bun.js/bindings/highway_strings.cpp`    | `src/highway_sys/highway_strings.cpp` | mv                                                      |

### `src/simdutf_sys/`

| current                               | new                               | op  |
| ------------------------------------- | --------------------------------- | --- |
| `src/bun.js/bindings/bun-simdutf.zig` | `src/simdutf_sys/simdutf.zig`     | mv  |
| `src/bun.js/bindings/bun-simdutf.cpp` | `src/simdutf_sys/bun-simdutf.cpp` | mv  |

### `src/mimalloc_sys/`

| current                                         | new                             | op    |
| ----------------------------------------------- | ------------------------------- | ----- |
| `src/allocators/mimalloc.zig` (extern fn block) | `src/mimalloc_sys/mimalloc.zig` | split |

### `src/platform/`

| current                                       | new                         | op                                                                 |
| --------------------------------------------- | --------------------------- | ------------------------------------------------------------------ |
| `src/darwin.zig`                              | `src/platform/darwin.zig`   | mv; delete unused `const bun = @import("bun")` (`:104`)            |
| `src/linux.zig` (extern fns + constants)      | `src/platform/linux.zig`    | mv                                                                 |
| `src/linux.zig:6` `MemFdAllocator` re-export  | —                           | delete (callers use `bun.allocators.LinuxMemFdAllocator` directly) |
| `src/linux.zig:25-66` `RWFFlagSupport`        | `src/sys/linux_rwf.zig`     | split → absorbed by `sys`                                          |
| `src/linux.zig:71-73` `ioctl_ficlone(bun.FD)` | `src/sys/linux_ficlone.zig` | split → absorbed by `sys`                                          |

### `src/lolhtml_sys/`

| current                                                    | new                                 | op                          |
| ---------------------------------------------------------- | ----------------------------------- | --------------------------- |
| `src/deps/lol-html.zig`                                    | `src/lolhtml_sys/lol_html.zig`      | mv                          |
| `src/deps/lol-html.zig:603-616` `HTMLString.toString/toJS` | `src/runtime/api/html_rewriter.zig` | split → absorbed by runtime |

### `src/windows_sys/` + `src/libuv_sys/`

| current                                                                                                         | new                           | op                          |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------- |
| `src/windows.zig:90-153,2980-3103` 49 extern fn + Win32 types/constants                                         | `src/windows_sys/windows.zig` | split                       |
| `src/deps/libuv.zig` (302 extern fn + structs + `UV_*` constants)                                               | `src/libuv_sys/libuv.zig`     | mv                          |
| `src/deps/libuv.zig:2776-2870` `translateUVErrorToE`                                                            | `src/errno/uv_translate.zig`  | split → absorbed by `errno` |
| `src/deps/libuv.zig:1327-1544,2434-2446` `Maybe`-returning wrappers (`Pipe.init`, `StreamMixin`, `HandleMixin`) | `src/sys/uv_wrappers.zig`     | split → absorbed by `sys`   |

### `src/boringssl_sys/` + `src/boringssl/`

| current                                                                                                  | new                                                | op                        |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------- |
| `src/deps/boringssl.translated.zig`                                                                      | `src/boringssl_sys/boringssl.zig`                  | mv                        |
| `src/deps/boringssl.translated.zig:19011-19012` `us_ssl_socket_verify_error_from_ssl` + `getVerifyError` | `src/uws/ssl_verify.zig`                           | split → absorbed by `uws` |
| `src/boringssl.zig`                                                                                      | `src/boringssl/boringssl.zig`                      | mv                        |
| `src/boringssl.zig:263` `ERR_toJS`                                                                       | `src/runtime/crypto/boringssl_jsc.zig`             | split → runtime           |
| `src/bun.js/api/bun/x509.zig:1-53` `isSafeAltName` (pure helper)                                         | `src/boringssl/x509_util.zig`                      | split → absorbed here     |
| `src/bun.js/api/bun/ssl_wrapper.zig`                                                                     | `src/boringssl/ssl_wrapper.zig`                    | mv → absorbed here        |
| `src/bun.js/api/server/SSLConfig.zig`                                                                    | `src/boringssl/SSLConfig.zig`                      | mv → absorbed here        |
| `src/bun.js/api/crypto/EVP.zig` (full) + `HMAC.zig` (~280 LOC pure wrappers)                             | `src/boringssl/evp.zig` + `src/boringssl/hmac.zig` | mv → absorbed here        |

### `src/cares_sys/`

| current                                                      | new                                 | op                          |
| ------------------------------------------------------------ | ----------------------------------- | --------------------------- |
| `src/deps/c_ares.zig` (60 extern fn + structs + `Error`)     | `src/cares_sys/c_ares.zig`          | mv                          |
| `src/deps/c_ares.zig:195-1754` `toJS`/`toJSResponse` methods | `src/runtime/dns_jsc/cares_jsc.zig` | split → absorbed by runtime |

### `src/picohttp_sys/` + `src/picohttp/`

| current                       | new                                   | op                                                        |
| ----------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `src/deps/picohttpparser.zig` | `src/picohttp_sys/picohttpparser.zig` | mv                                                        |
| `src/deps/picohttp.zig`       | `src/picohttp/picohttp.zig`           | mv; `:146` re-point to `bun.string.quote.writeJSONString` |

### `src/uws_sys/` + `src/uws/`

| current                                                                                                                   | new                                       | op                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `src/deps/uws.zig`                                                                                                        | `src/uws/uws.zig`                         | mv                                                                                                   |
| `src/deps/uws/*.zig` (extern blocks: 309 extern fn across `Loop`/`App`/`Response`/`h3`/`us_socket_t`/`WebSocket`/`udp`/…) | `src/uws_sys/*.zig`                       | split (extern decls only)                                                                            |
| `src/deps/uws/*.zig` (safe wrappers)                                                                                      | `src/uws/*.zig`                           | mv                                                                                                   |
| `src/deps/uws/handlers.zig`                                                                                               | `src/runtime/socket/uws_handlers.zig`     | mv → absorbed by runtime                                                                             |
| `src/deps/uws/dispatch.zig`                                                                                               | `src/runtime/socket/uws_dispatch.zig`     | mv → absorbed by runtime                                                                             |
| `src/deps/uws/UpgradedDuplex.zig`                                                                                         | `src/runtime/socket/UpgradedDuplex.zig`   | mv → absorbed by runtime                                                                             |
| `src/deps/uws/WindowsNamedPipe.zig`                                                                                       | `src/runtime/socket/WindowsNamedPipe.zig` | mv → absorbed by runtime                                                                             |
| `src/deps/uws/us_socket_t.zig:346-400` `writeJS` helper                                                                   | `src/runtime/socket/uws_jsc.zig`          | split → runtime                                                                                      |
| `src/deps/uws/WebSocket.zig:52,350` `getTopicsAsJSArray`                                                                  | `src/runtime/socket/uws_jsc.zig`          | split → runtime                                                                                      |
| `src/deps/uws/InternalLoopData.zig:27-56` `jsc_vm` field accessors                                                        | `src/uws/InternalLoopData.zig`            | unchanged in this PR (cycle tolerated); at port time field becomes `?*anyopaque`, accessor in `jsc/` |

### `src/libarchive_sys/` + `src/libarchive/`

| current                                  | new                               | op        |
| ---------------------------------------- | --------------------------------- | --------- |
| `src/libarchive/libarchive-bindings.zig` | `src/libarchive_sys/bindings.zig` | mv        |
| `src/libarchive/libarchive.zig`          | `src/libarchive/libarchive.zig`   | unchanged |

### `src/string_sys/` + `src/string/`

| current                                                                                                                                                | new                                    | op                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | ------------------------------- |
| `src/string.zig:71,384,391,448,453,558,855-857,1090-1092` `BunString__*`/`JSC__create*Error` extern fns + `toJS`/`fromJS`/`transferToJS`/`createArray` | `src/jsc/BunString_jsc.zig`            | split → absorbed by `jsc`       |
| `src/string/immutable/visible.zig:1377` `extern fn icu_hasBinaryProperty`                                                                              | `src/string_sys/icu.zig`               | split                           |
| `src/string/immutable.zig:2417` `extern fn Bun__ANSI__next`                                                                                            | `src/string_sys/ansi.zig`              | split                           |
| `src/string/wtf.zig` extern decls                                                                                                                      | `src/string_sys/wtf.zig`               | split                           |
| `src/string/immutable.zig:4` `memmem = bun.sys.workaround_symbols.memmem`                                                                              | `src/string_sys/memmem.zig`            | split                           |
| `src/string.zig` (remainder)                                                                                                                           | `src/string/String.zig`                | mv                              |
| `src/string/*.zig`                                                                                                                                     | unchanged                              | —                               |
| `src/js_printer.zig` `quoteForJSON`/`writePreQuotedString`/`writeJSONString`                                                                           | `src/string/quote.zig`                 | split → absorbed here           |
| `src/collections/baby_list.zig:349-441` `BabyList(u8)` string helpers                                                                                  | `src/string/baby_list_ext.zig`         | split → absorbed here           |
| `src/string/MutableString.zig:353` `BufferedWriter.writeString(ast.E.String)`                                                                          | `src/js_parser/mutable_string_ext.zig` | split → absorbed by `js_parser` |
| `src/string/escapeRegExp.zig` (JSC refs)                                                                                                               | `src/jsc/escapeRegExp_jsc.zig`         | split → `jsc`                   |

### `src/install_types/`

| current                                                            | new                                                         | op    |
| ------------------------------------------------------------------ | ----------------------------------------------------------- | ----- |
| `src/install/PackageManager.zig` `Options.NodeLinker` enum         | `src/install_types/NodeLinker.zig`                          | split |
| `src/install/Npm.zig` `Registry` struct                            | `src/install_types/Registry.zig`                            | split |
| `src/install/PnpmMatcher.zig` (struct + `fromExpr`)                | `src/install_types/PnpmMatcher.zig`                         | mv    |
| `src/semver/SemverString.zig` (8B SSO type) + `ExternalString.zig` | `src/install_types/SemverString.zig` + `ExternalString.zig` | mv    |
| `src/install/lockfile/` `WorkspaceMap` type                        | `src/install_types/WorkspaceMap.zig`                        | split |

### `src/options_types/`

| current                                                                            | new                               | op    |
| ---------------------------------------------------------------------------------- | --------------------------------- | ----- |
| `src/cli.zig` `Command.{Context,Tag,TestOptions,Debugger,HotReload}` structs/enums | `src/options_types/Command.zig`   | split |
| `src/cli.zig` `Arguments` struct, `debug_flags`, `start_time`                      | `src/options_types/Arguments.zig` | split |

### `src/resolve_builtins/`

| current                                       | new                                        | op  |
| --------------------------------------------- | ------------------------------------------ | --- |
| `src/bun.js/ModuleLoader/HardcodedModule.zig` | `src/resolve_builtins/HardcodedModule.zig` | mv  |

### `src/safety/`

| current                          | new                   | op                                                                              |
| -------------------------------- | --------------------- | ------------------------------------------------------------------------------- |
| `src/asan.zig`                   | `src/safety/asan.zig` | mv                                                                              |
| `src/safety/ThreadLock.zig`      | unchanged             | —                                                                               |
| `src/safety/CriticalSection.zig` | unchanged             | —                                                                               |
| `src/safety/alloc.zig`           | unchanged             | `hasPtr()` (`:25-36`) re-points to `mimalloc_sys.mi_is_in_heap_region` directly |

### `src/collections/`

| current                                                              | new                                       | op                        |
| -------------------------------------------------------------------- | ----------------------------------------- | ------------------------- |
| `src/collections.zig`                                                | `src/collections/collections.zig`         | mv                        |
| `src/collections/*.zig`                                              | unchanged                                 | —                         |
| `src/StaticHashMap.zig`                                              | `src/collections/StaticHashMap.zig`       | mv                        |
| `src/comptime_string_map.zig`                                        | `src/collections/comptime_string_map.zig` | mv                        |
| `src/linear_fifo.zig`                                                | `src/collections/linear_fifo.zig`         | mv                        |
| `src/identity_context.zig`                                           | `src/collections/identity_context.zig`    | mv                        |
| `src/pool.zig`                                                       | `src/collections/pool.zig`                | mv                        |
| `src/collections/baby_list.zig:456-475` `parse/toCss/eql`            | `src/css/baby_list_ext.zig`               | split → absorbed by `css` |
| `src/comptime_string_map.zig:194-210` `fromJS/fromJSCaseInsensitive` | `src/jsc/comptime_string_map_jsc.zig`     | split → absorbed by `jsc` |

### `src/threading/`

| current               | new                           | op  |
| --------------------- | ----------------------------- | --- |
| `src/threading.zig`   | `src/threading/threading.zig` | mv  |
| `src/threading/*.zig` | unchanged                     | —   |
| `src/work_pool.zig`   | `src/threading/work_pool.zig` | mv  |

### `src/bun_alloc/`

| current                  | new                                | op         |
| ------------------------ | ---------------------------------- | ---------- |
| `src/allocators.zig`     | `src/bun_alloc/bun_alloc.zig`      | mv         |
| `src/allocators/*.zig`   | `src/bun_alloc/*.zig`              | mv         |
| `src/memory.zig`         | `src/bun_alloc/memory.zig`         | mv         |
| `src/heap_breakdown.zig` | `src/bun_alloc/heap_breakdown.zig` | mv         |
| `src/ptr.zig`            | `src/bun_alloc/ptr.zig`            | mv (merge) |
| `src/ptr/*.zig`          | `src/bun_alloc/ptr/*.zig`          | mv (merge) |

### `src/bun_core/`

| current                                                | new                              | op                                                         |
| ------------------------------------------------------ | -------------------------------- | ---------------------------------------------------------- |
| `src/output.zig`                                       | `src/bun_core/output.zig`        | mv; `fmt.zig:232,234,678` → re-point to `bun.string.quote` |
| `src/Progress.zig`                                     | `src/bun_core/Progress.zig`      | mv                                                         |
| `src/tty.zig`                                          | `src/bun_core/tty.zig`           | mv                                                         |
| `src/fmt.zig`                                          | `src/bun_core/fmt.zig`           | mv                                                         |
| `src/Global.zig` (version constants, exit/atexit)      | `src/bun_core/Global.zig`        | mv                                                         |
| `src/env.zig`                                          | `src/bun_core/env.zig`           | mv                                                         |
| `src/feature_flags.zig`                                | `src/bun_core/feature_flags.zig` | mv                                                         |
| `src/env_var.zig`                                      | `src/bun_core/env_var.zig`       | mv                                                         |
| `src/util.zig`                                         | `src/bun_core/util.zig`          | mv                                                         |
| `src/result.zig`                                       | `src/bun_core/result.zig`        | mv                                                         |
| `src/deprecated.zig`                                   | `src/bun_core/deprecated.zig`    | mv                                                         |
| (new) `timespec` struct (from wherever it lives today) | `src/bun_core/timespec.zig`      | split                                                      |

### `src/perf/`

| current                               | new                                        | op  |
| ------------------------------------- | ------------------------------------------ | --- |
| `src/tracy.zig`                       | `src/perf/tracy.zig`                       | mv  |
| `src/perf.zig`                        | `src/perf/perf.zig`                        | mv  |
| `src/hw_timer.zig`                    | `src/perf/hw_timer.zig`                    | mv  |
| `src/system_timer.zig`                | `src/perf/system_timer.zig`                | mv  |
| `src/generated_perf_trace_events.zig` | `src/perf/generated_perf_trace_events.zig` | mv  |

### `src/analytics/`

| current                    | new                           | op                                                                    |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------- |
| `src/analytics.zig`        | `src/analytics/analytics.zig` | mv; `:31` re-point enum-set to `bun.resolve_builtins.HardcodedModule` |
| `src/analytics/schema.zig` | unchanged                     | —                                                                     |

### `src/semver/` + `src/semver_jsc/`

| current                                                                                            | new                                   | op                                            |
| -------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------- |
| `src/semver.zig`                                                                                   | `src/semver/semver.zig`               | mv                                            |
| `src/semver/*.zig`                                                                                 | unchanged                             | —                                             |
| `src/semver/SemverString.zig`                                                                      | `src/install_types/SemverString.zig`  | mv (re-export from `semver/` for back-compat) |
| `src/semver/SemverObject.zig`                                                                      | `src/semver_jsc/SemverObject.zig`     | mv                                            |
| `src/semver/SemverString.zig:457` `toJS`                                                           | `src/semver_jsc/SemverString_jsc.zig` | split                                         |
| `src/semver/SemverString.zig:30,255,276` `Buf.init/hashContext/arrayHashContext` (Lockfile-taking) | `src/install/semver_ext.zig`          | split → absorbed by `install`                 |

### `src/options_types/`

| current                                                                             | new                                   | op                                                           |
| ----------------------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------ |
| `src/api/schema.zig`                                                                | `src/options_types/schema.zig`        | mv                                                           |
| `src/api/schema.zig:2884-2970` `NpmRegistry.Parser`                                 | `src/install/npm_registry_parser.zig` | split → absorbed by `install`                                |
| `src/api/schema.zig:3069-3079` `BunInstall.node_linker`/`hoist_pattern` field types | —                                     | re-point to `bun.install_types.{NodeLinker,PnpmMatcher}`     |
| `src/api/schema.zig:431` `StackFramePosition` alias                                 | —                                     | delete; callers use `bun.jsc.ZigStackFramePosition` directly |
| `src/api/schema.zig:1980` `SourceMapMode.fromJS`                                    | `src/jsc/schema_jsc.zig`              | split → `jsc`                                                |

### `src/errno/`

| current                                                                                                                 | new                               | op                    |
| ----------------------------------------------------------------------------------------------------------------------- | --------------------------------- | --------------------- |
| `src/errno/*.zig`                                                                                                       | unchanged                         | —                     |
| `src/windows.zig:2969-3042,3389` `Win32Error.toSystemErrno`/`translateNTStatusToErrno`/`WSAGetLastError`/`getLastErrno` | `src/errno/windows_translate.zig` | split → absorbed here |

### `src/sys/` + `src/sys_jsc/`

| current                                                               | new                            | op                                                |
| --------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------- |
| `src/sys.zig`                                                         | `src/sys/sys.zig`              | mv                                                |
| `src/sys.zig:338` `bun.api.node.Maybe`                                | `src/sys/Maybe.zig`            | define `Maybe` here; `bun.api.node` re-exports it |
| `src/fd.zig`                                                          | `src/sys/fd.zig`               | mv                                                |
| `src/fd.zig:317-381` `FD.fromJS/fromJSValidated/toJS/…`               | `src/sys_jsc/fd_jsc.zig`       | split                                             |
| `src/sys/Error.zig:215-332` `toShellSystemError/toSystemError/toJS/…` | `src/sys_jsc/error_jsc.zig`    | split                                             |
| `src/sys/File.zig:436-451` `toSourceAt/toSource`                      | `src/logger/file_source.zig`   | split → absorbed by `logger`                      |
| `src/sys_uv.zig`                                                      | `src/sys/sys_uv.zig`           | mv                                                |
| `src/tmp.zig`                                                         | `src/sys/tmp.zig`              | mv                                                |
| `src/copy_file.zig`                                                   | `src/sys/copy_file.zig`        | mv                                                |
| `src/walker_skippable.zig`                                            | `src/sys/walker_skippable.zig` | mv                                                |
| `src/dir.zig`                                                         | `src/sys/dir.zig`              | mv                                                |
| `src/SignalCode.zig` (minus `fromJS`)                                 | `src/sys/SignalCode.zig`       | mv                                                |
| `src/windows.zig` (remainder: wrapper glue)                           | `src/sys/windows/windows.zig`  | mv (merge)                                        |
| `src/windows/env.zig`                                                 | `src/sys/windows/env.zig`      | mv                                                |
| `src/windows.zig:3220-3230` `Bun__UVSignalHandle__init`               | `src/jsc/uv_signal.zig`        | split → absorbed by `jsc`                         |
| `src/windows.zig:3811` `pub const spawn = …PosixSpawn`                | —                              | delete; callers use `bun.spawn` directly          |

### `src/paths/`

| current                                                    | new                          | op                                   |
| ---------------------------------------------------------- | ---------------------------- | ------------------------------------ |
| `src/paths.zig`                                            | `src/paths/paths.zig`        | mv                                   |
| `src/paths/*.zig`                                          | unchanged                    | —                                    |
| `src/resolver/resolve_path.zig` (join/relative algorithms) | `src/paths/resolve_path.zig` | mv (absorbed; `resolver` re-exports) |
| `src/paths/Path.zig:295-314` `initTopLevelDir`             | `src/resolver/fs_ext.zig`    | split → absorbed by `resolver`       |
| `src/paths/Path.zig:343` `initFdPath`                      | `src/sys/fd_path.zig`        | split → absorbed by `sys`            |

### `src/crash_handler/`

| current                                                | new                                     | op              |
| ------------------------------------------------------ | --------------------------------------- | --------------- |
| `src/crash_handler.zig`                                | `src/crash_handler/crash_handler.zig`   | mv              |
| `src/handle_oom.zig`                                   | `src/crash_handler/handle_oom.zig`      | mv              |
| `src/bun.js/bindings/CPUFeatures.zig`                  | `src/crash_handler/CPUFeatures.zig`     | mv              |
| `src/crash_handler.zig:1890-1979` `js_bindings` struct | `src/runtime/api/crash_handler_jsc.zig` | split → runtime |

### `src/clap/`

| current                        | new                 | op  |
| ------------------------------ | ------------------- | --- |
| `src/deps/zig-clap/clap.zig`   | `src/clap/clap.zig` | mv  |
| `src/deps/zig-clap/clap/*.zig` | `src/clap/*.zig`    | mv  |

### `src/sha_hmac/`

| current                                                        | new                              | op                    |
| -------------------------------------------------------------- | -------------------------------- | --------------------- |
| `src/sha.zig`                                                  | `src/sha_hmac/sha.zig`           | mv                    |
| `src/hmac.zig`                                                 | `src/sha_hmac/hmac.zig`          | mv                    |
| `src/bun.js/api/crypto/EVP.zig:9-62` `Algorithm` enum + `md()` | `src/sha_hmac/evp_algorithm.zig` | split → absorbed here |

### `src/csrf/`

| current                                                          | new                                      | op                          |
| ---------------------------------------------------------------- | ---------------------------------------- | --------------------------- |
| `src/csrf.zig:68-209` `generate()`/`verify()`                    | `src/csrf/csrf.zig`                      | split                       |
| `src/csrf.zig:213-378` `csrf__generate_impl`/`csrf__verify_impl` | `src/runtime/api/BunObject.zig` (inline) | split → absorbed by runtime |

### `src/s3_signing/`

| current                                                                   | new                            | op                       |
| ------------------------------------------------------------------------- | ------------------------------ | ------------------------ |
| `src/s3/credentials.zig`, `acl.zig`, `storage_class.zig`, signing helpers | `src/s3_signing/*.zig`         | mv                       |
| `src/s3/client.zig`, `multipart.zig`, Blob-producing half                 | `src/runtime/webcore/s3/*.zig` | mv → absorbed by runtime |

### `src/zstd/`

| current             | new                 | op  |
| ------------------- | ------------------- | --- |
| `src/deps/zstd.zig` | `src/zstd/zstd.zig` | mv  |

### `src/base64/`

| current                                                      | new       | op                                            |
| ------------------------------------------------------------ | --------- | --------------------------------------------- |
| `src/base64/base64.zig`                                      | unchanged | `bun.simdutf` re-points to `src/simdutf_sys/` |
| `src/base64/base64.zig:100` `extern fn WTF__base64URLEncode` | —         | keep (links WTF; documented as `_sys`-level)  |

### `src/io/`

| current        | new       | op  |
| -------------- | --------- | --- |
| `src/io/*.zig` | unchanged | —   |

### `src/async/`

| current                       | new                                 | op  |
| ----------------------------- | ----------------------------------- | --- |
| `src/async/*.zig`             | unchanged                           | —   |
| `src/ParentDeathWatchdog.zig` | `src/async/ParentDeathWatchdog.zig` | mv  |

### `src/event_loop/`

| current                                                                                                                                        | new                             | op                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------ |
| `src/bun.js/event_loop/{Task,ConcurrentTask,EventLoopTimer,AutoFlusher,DeferredTaskQueue,MiniEventLoop,AnyEventLoop,WorkTask,ManagedTask}.zig` | `src/event_loop/*.zig`          | mv                                         |
| `src/bun.js/event_loop/JSCScheduler.zig`                                                                                                       | `src/jsc/JSCScheduler.zig`      | mv → absorbed by `jsc` (touches `JSValue`) |
| `src/bun.js/event_loop/event_loop.zig` (the `*VirtualMachine`-owning `EventLoop`)                                                              | `src/jsc/EventLoop.zig`         | mv → absorbed by `jsc`                     |
| `src/bun.js/api/Timer/` (heap impl)                                                                                                            | `src/event_loop/timer_heap.zig` | mv                                         |

### `src/logger/` + `src/logger_jsc/`

| current                                                                                   | new                             | op                              |
| ----------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------- |
| `src/logger.zig`                                                                          | `src/logger/logger.zig`         | mv                              |
| `src/logger.zig` `Level.fromJS`/`Msg.fromJS/toJS`/`Log.toJS/toJSArray/toJSAggregateError` | `src/logger_jsc/logger_jsc.zig` | split                           |
| `src/logger.zig:1001-1011` `Log.addSysError`                                              | `src/sys/error_log.zig`         | split → absorbed by `sys`       |
| `src/logger.zig:1356-1358` `Source.rangeOfIdentifier` (delegates to `js_lexer`)           | `src/js_parser/logger_ext.zig`  | split → absorbed by `js_parser` |

### `src/url/` + `src/url_jsc/`

| current                                                                               | new                               | op                                            |
| ------------------------------------------------------------------------------------- | --------------------------------- | --------------------------------------------- |
| `src/url.zig`                                                                         | `src/url/url.zig`                 | mv                                            |
| `src/url.zig:43-66` `URL.isBlob/fromJS/fromString`                                    | `src/url_jsc/url_jsc.zig`         | split                                         |
| `src/url.zig:1003-1150` `FormData.toJS`/`jsFunctionFromMultipartData`/`AsyncFormData` | `src/url_jsc/form_data_jsc.zig`   | split                                         |
| `src/url.zig:1296-1376` `PathnameScanner`/`CombinedScanner`                           | `src/router/pathname_scanner.zig` | split → absorbed by `router`                  |
| `src/router.zig` `Param` struct                                                       | `src/url/Param.zig`               | split → absorbed here (breaks `url`↔`router`) |

### `src/dns/`

| current                                                                                            | new                           | op                                            |
| -------------------------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------- |
| `src/dns.zig`                                                                                      | `src/dns/dns.zig`             | mv                                            |
| `src/dns.zig:78,138,198,239,301,329,379,425,439` `fromJS`/`toJS`/`addressToJS`/`addrInfoToJSArray` | `src/runtime/dns_jsc/dns.zig` | split → absorbed by runtime                   |
| `src/dns.zig:464` `pub const internal = bun.api.dns.internal`                                      | —                             | delete; callers import `bun.api.dns` directly |

### `src/glob/`

| current          | new                 | op  |
| ---------------- | ------------------- | --- |
| `src/glob.zig`   | `src/glob/glob.zig` | mv  |
| `src/glob/*.zig` | unchanged           | —   |

### `src/which/`

| current                    | new                            | op                     |
| -------------------------- | ------------------------------ | ---------------------- |
| `src/which.zig`            | `src/which/which.zig`          | mv                     |
| `src/which_npm_client.zig` | `src/cli/which_npm_client.zig` | mv → absorbed by `cli` |

### `src/patch/` + `src/patch_jsc/`

| current                                 | new                         | op                                                  |
| --------------------------------------- | --------------------------- | --------------------------------------------------- |
| `src/patch.zig`                         | `src/patch/patch.zig`       | mv; `:80,97` → re-point to `bun.sys.mkdirRecursive` |
| `src/patch.zig:1096-1231` `TestingAPIs` | `src/patch_jsc/testing.zig` | split                                               |

### `src/ini/`

| current                                                                              | new                             | op                            |
| ------------------------------------------------------------------------------------ | ------------------------------- | ----------------------------- |
| `src/ini.zig:1-575` `Parser`                                                         | `src/ini/ini.zig`               | split                         |
| `src/ini.zig:720-1473` `ConfigIterator`/`ScopeIterator`/`loadNpmrc*`/`NodeLinkerMap` | `src/install/npmrc.zig`         | split → absorbed by `install` |
| `src/ini.zig:577-693` `IniTestingAPIs`                                               | `src/install/npmrc_testing.zig` | split → absorbed by `install` |

### `src/watcher/`

| current                                       | new                                | op                             |
| --------------------------------------------- | ---------------------------------- | ------------------------------ |
| `src/Watcher.zig`                             | `src/watcher/Watcher.zig`          | mv                             |
| `src/watcher/*.zig`                           | unchanged                          | —                              |
| `src/Watcher.zig:782-783` `getResolveWatcher` | `src/resolver/resolve_watcher.zig` | split → absorbed by `resolver` |

### `src/md/`

| current        | new       | op  |
| -------------- | --------- | --- |
| `src/md/*.zig` | unchanged | —   |

### `src/sourcemap/` + `src/sourcemap_jsc/`

| current                                                                                                                        | new                                     | op                                                           |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- | ------------------------------------------------------------ |
| `src/sourcemap/{VLQ,LineOffsetTable,Mapping,Chunk,ParsedSourceMap,InternalSourceMap,sourcemap}.zig`                            | unchanged                               | `Chunk.zig:81` → re-point to `bun.string.quote.quoteForJSON` |
| `src/sourcemap/JSSourceMap.zig`                                                                                                | `src/sourcemap_jsc/JSSourceMap.zig`     | mv                                                           |
| `src/sourcemap/CodeCoverage.zig`                                                                                               | `src/sourcemap_jsc/CodeCoverage.zig`    | mv                                                           |
| `src/sourcemap/sourcemap.zig:493-588` `SourceProviderMap`/`BakeSourceProvider`/`DevServerSourceProvider` opaques + 6 extern fn | `src/sourcemap_jsc/source_provider.zig` | split                                                        |
| `src/sourcemap/InternalSourceMap.zig:921-963` `fromVLQ`/`toVLQ`/`find` JS exports                                              | `src/sourcemap_jsc/internal_jsc.zig`    | split                                                        |

### `src/css/` + `src/css_jsc/`

| current                               | new                             | op                                                                                                                                                                              |
| ------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/css/*.zig`                       | unchanged                       | `css_parser.zig:1` `SrcIndex` → `bun.js_parser.Index`; `:92` `Maybe` → `bun.sys.Maybe`; `targets.zig:64` → `bun.bundler.options.Target` (forward via `options_types` if needed) |
| `src/css/css_internals.zig`           | `src/css_jsc/css_internals.zig` | mv                                                                                                                                                                              |
| `src/css/values/color_js.zig`         | `src/css_jsc/color_js.zig`      | mv                                                                                                                                                                              |
| `src/css/error.zig` `toErrorInstance` | `src/css_jsc/error_jsc.zig`     | split                                                                                                                                                                           |

### `src/valkey/`

| current                                                                                                                  | new                              | op                       |
| ------------------------------------------------------------------------------------------------------------------------ | -------------------------------- | ------------------------ |
| `src/valkey/valkey_protocol.zig` (minus `RESPValue.toJS` `:244-331`)                                                     | `src/valkey/valkey_protocol.zig` | unchanged                |
| `src/valkey/ValkeyCommand.zig` (`Args`/`serialize` half)                                                                 | `src/valkey/ValkeyCommand.zig`   | unchanged                |
| `src/valkey/{valkey,js_valkey,js_valkey_functions,ValkeyContext,index}.zig` + `RESPValue.toJS` + `ValkeyCommand.Promise` | `src/runtime/valkey_jsc/*.zig`   | mv → absorbed by runtime |

### `src/js_parser/` + `src/js_parser_jsc/`

| current                                                                | new                              | op    |
| ---------------------------------------------------------------------- | -------------------------------- | ----- |
| `src/ast.zig`                                                          | `src/js_parser/js_parser.zig`    | mv    |
| `src/ast/*.zig`                                                        | `src/js_parser/ast/*.zig`        | mv    |
| `src/js_parser.zig`                                                    | `src/js_parser/parser.zig`       | mv    |
| `src/js_lexer.zig`                                                     | `src/js_parser/lexer.zig`        | mv    |
| `src/js_lexer/*.zig`                                                   | `src/js_parser/lexer/*.zig`      | mv    |
| `src/js_lexer_tables.zig`                                              | `src/js_parser/lexer_tables.zig` | mv    |
| `src/runtime.zig`                                                      | `src/js_parser/runtime.zig`      | mv    |
| `src/ast/Macro.zig`                                                    | `src/js_parser_jsc/Macro.zig`    | mv    |
| `src/ast/Expr.zig` `toJS()` methods + `:79` `JSONParser.parseForMacro` | `src/js_parser_jsc/expr_jsc.zig` | split |

### `src/js_printer/`

| current              | new                             | op                                                        |
| -------------------- | ------------------------------- | --------------------------------------------------------- |
| `src/js_printer.zig` | `src/js_printer/js_printer.zig` | mv; `:431` `mangled_props` → `bun.js_parser.MangledProps` |
| `src/renamer.zig`    | `src/js_printer/renamer.zig`    | mv                                                        |

### `src/interchange/`

| current                 | new                               | op  |
| ----------------------- | --------------------------------- | --- |
| `src/interchange.zig`   | `src/interchange/interchange.zig` | mv  |
| `src/interchange/*.zig` | unchanged                         | —   |

### `src/exe_format/` + `src/standalone_graph/`

| current                                                                                      | new                                 | op                            |
| -------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------- |
| `src/elf.zig`                                                                                | `src/exe_format/elf.zig`            | mv                            |
| `src/macho.zig`                                                                              | `src/exe_format/macho.zig`          | mv                            |
| `src/pe.zig`                                                                                 | `src/exe_format/pe.zig`             | mv                            |
| `src/StandaloneModuleGraph.zig` reader half (`base_path`/`get`/`find`/`SerializedSourceMap`) | `src/standalone_graph/reader.zig`   | split                         |
| `src/StandaloneModuleGraph.zig` `toExecutable`/`toBytes`                                     | `src/bundler/standalone_writer.zig` | split → absorbed by `bundler` |
| `src/compile_target.zig`                                                                     | `src/bundler/compile_target.zig`    | mv → absorbed by `bundler`    |

### `src/http_types/` + `src/http/` + `src/http_jsc/`

| current                                                                                                                                   | new                                   | op                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ------------------ |
| `src/http/{Method,MimeType,Encoding,ETag,URLPath}.zig` + `Fetch*` enums                                                                   | `src/http_types/*.zig`                | mv                 |
| `src/http/Method.zig:151` `extern fn Bun__HTTPMethod__toJS`                                                                               | `src/http_jsc/method_jsc.zig`         | split              |
| `src/http.zig` + `src/http/{AsyncHTTP,HTTPThread,HTTPContext,ProxyTunnel,h2_client,H2Client,H3Client,h3_client,Decompressor,Headers}.zig` | `src/http/*.zig`                      | unchanged/mv       |
| `src/http/Headers.zig:193-194` `toFetchHeaders` + `Blob`/`FetchHeaders` imports                                                           | `src/http_jsc/headers_jsc.zig`        | split              |
| `src/http/{H2Client,H3Client}.zig` `liveCounts(*JSGlobalObject,*CallFrame)`                                                               | `src/http_jsc/h2h3_jsc.zig`           | split              |
| `src/http/websocket_client.zig`                                                                                                           | `src/http_jsc/websocket_client.zig`   | mv                 |
| `src/http/websocket_client/*.zig`                                                                                                         | `src/http_jsc/websocket_client/*.zig` | mv                 |
| `src/bun.js/api/bun/lshpack.zig`                                                                                                          | `src/http/lshpack.zig`                | mv → absorbed here |

### `src/router/`

| current                                               | new                          | op                            |
| ----------------------------------------------------- | ---------------------------- | ----------------------------- |
| `src/router.zig`                                      | `src/router/router.zig`      | mv                            |
| `src/router.zig` `pub const Test` block (`~940-1050`) | `src/router/router_test.zig` | split (test-only scaffolding) |

### `src/resolver/`

| current                  | new                                            | op  |
| ------------------------ | ---------------------------------------------- | --- |
| `src/resolver/*.zig`     | unchanged (minus `resolve_path.zig` → `paths`) | —   |
| `src/fs.zig`             | `src/resolver/fs.zig`                          | mv  |
| `src/fs/*.zig`           | `src/resolver/fs/*.zig`                        | mv  |
| `src/node_fallbacks.zig` | `src/resolver/node_fallbacks.zig`              | mv  |

### `src/dotenv/`

| current              | new                         | op  |
| -------------------- | --------------------------- | --- |
| `src/env_loader.zig` | `src/dotenv/env_loader.zig` | mv  |

### `src/shell_parser/`

| current                                  | new                      | op  |
| ---------------------------------------- | ------------------------ | --- |
| `src/shell/braces.zig` + lexer/AST files | `src/shell_parser/*.zig` | mv  |

### `src/install/` + `src/install_jsc/`

| current                                                                         | new                                    | op                                        |
| ------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------- |
| `src/install/**`                                                                | unchanged                              | minus types extracted to `install_types/` |
| `src/install/install_binding.zig`                                               | `src/install_jsc/install_binding.zig`  | mv                                        |
| `src/install/security_scanner.zig`                                              | `src/install_jsc/security_scanner.zig` | mv                                        |
| `src/install/npm.zig` `jsFunction*`/`toJS` blocks                               | `src/install_jsc/npm_jsc.zig`          | split                                     |
| `src/install/PackageManager.zig` `UpdateRequest.fromJS`, `jsParseLockfile` etc. | `src/install_jsc/manager_jsc.zig`      | split                                     |
| `src/ConfigVersion.zig`                                                         | `src/install/ConfigVersion.zig`        | mv                                        |

### `src/bundler/` + `src/bundler_jsc/`

| current                                                                       | new                                             | op    |
| ----------------------------------------------------------------------------- | ----------------------------------------------- | ----- |
| `src/bundler/*.zig`                                                           | unchanged                                       | —     |
| `src/transpiler.zig`                                                          | `src/bundler/transpiler.zig`                    | mv    |
| `src/linker.zig`                                                              | `src/bundler/linker.zig`                        | mv    |
| `src/options.zig`                                                             | `src/bundler/options.zig`                       | mv    |
| `src/defines.zig` + `src/defines-table.zig`                                   | `src/bundler/defines.zig` + `defines-table.zig` | mv    |
| `src/import_record.zig`                                                       | `src/bundler/import_record.zig`                 | mv    |
| `src/cache.zig`                                                               | `src/bundler/cache.zig`                         | mv    |
| `src/OutputFile.zig`                                                          | `src/bundler/OutputFile.zig`                    | mv    |
| `src/HTMLScanner.zig`                                                         | `src/bundler/HTMLScanner.zig`                   | mv    |
| `src/analyze_transpiled_module.zig`                                           | `src/bundler/analyze_transpiled_module.zig`     | mv    |
| `src/bundler/bundle_v2.zig` `JSBundleCompletionTask` + plugin/hot-reload glue | `src/bundler_jsc/*.zig`                         | split |
| `src/OutputFile.zig` `toJS`/`toBlob`/`SavedFile.toJS`                         | `src/bundler_jsc/output_file_jsc.zig`           | split |

### `src/sql/` + `src/sql_jsc/`

| current                                                                                                            | new              | op        |
| ------------------------------------------------------------------------------------------------------------------ | ---------------- | --------- |
| `src/sql/{postgres,mysql,shared}/**` protocol files                                                                | `src/sql/**`     | unchanged |
| `src/sql/**/js/`, `JSMySQLConnection.zig`, `PostgresSQLQuery.zig`, JS-touching half of `PostgresSQLConnection.zig` | `src/sql_jsc/**` | mv/split  |

### `src/jsc/`

| current                                                                                                       | new                                         | op             |
| ------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | -------------- |
| `src/bun.js/jsc.zig`                                                                                          | `src/jsc/jsc.zig`                           | mv             |
| `src/bun.js/bindings/{JSValue,JSRef,CallFrame,MarkedArgumentBuffer}.zig` + all sibling `.zig` opaque wrappers | `src/jsc/*.zig`                             | mv             |
| `src/bun.js/Strong.zig`                                                                                       | `src/jsc/Strong.zig`                        | mv             |
| `src/bun.js/jsc/host_fn.zig`                                                                                  | `src/jsc/host_fn.zig`                       | mv             |
| `src/bun.js/VirtualMachine.zig`, `ConsoleObject.zig`, `javascript.zig`                                        | `src/jsc/*.zig`                             | mv             |
| `src/bun.js/ModuleLoader/` (minus `HardcodedModule.zig`)                                                      | `src/jsc/ModuleLoader/`                     | mv             |
| `src/bun.js/event_loop/event_loop.zig`, `JSCScheduler.zig`                                                    | `src/jsc/EventLoop.zig`, `JSCScheduler.zig` | mv             |
| `src/btjs.zig`                                                                                                | `src/jsc/btjs.zig`                          | mv             |
| `src/bun.js/bindings/**/*.{cpp,h,mm,c}`                                                                       | `src/jsc/bindings/**`                       | mv (path-only) |
| `src/bun.js/modules/*.cpp`                                                                                    | `src/jsc/modules/*.cpp`                     | mv             |
| `src/vm/*.cpp`                                                                                                | `src/jsc/bindings/vm/*.cpp`                 | mv             |

### `src/runtime/`

| current                                                                                                  | new                                                      | op  |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | --- |
| `src/bun.js/api/**`                                                                                      | `src/runtime/api/**`                                     | mv  |
| `src/bun.js/api/bun/socket*.zig`, `udp_socket.zig`, `socket/`                                            | `src/runtime/socket/`                                    | mv  |
| `src/bun.js/api/server*.zig`, `server/` (minus `SSLConfig.zig` → `boringssl/`)                           | `src/runtime/server/`                                    | mv  |
| `src/bun.js/webcore/**`                                                                                  | `src/runtime/webcore/**`                                 | mv  |
| `src/bun.js/node/**`                                                                                     | `src/runtime/node/**`                                    | mv  |
| `src/bun.js/api/crypto/` (JS glue; pure EVP/HMAC sunk to `boringssl/`)                                   | `src/runtime/crypto/`                                    | mv  |
| `src/bun.js/api/FFI.zig`                                                                                 | `src/runtime/ffi/FFI.zig`                                | mv  |
| `src/bun.js/webview/**`                                                                                  | `src/runtime/webview/**`                                 | mv  |
| `src/bun.js/api/Timer/` JS classes (`TimeoutObject`/`ImmediateObject`/`TimerObjectInternals`/`WTFTimer`) | `src/runtime/timer/`                                     | mv  |
| `**/*.classes.ts` + `**/*.bind.ts`                                                                       | move alongside their `.zig` impl under `src/runtime/**/` | mv  |

### `src/shell/`

| current                                              | new       | op  |
| ---------------------------------------------------- | --------- | --- |
| `src/shell/*.zig` (interpreter + builtins + subproc) | unchanged | —   |
| (lexer/AST/braces moved to `shell_parser/` above)    |           |     |

### `src/napi/`

| current                              | new         | op           |
| ------------------------------------ | ----------- | ------------ |
| `src/bun.js/napi*.zig` + `src/napi/` | `src/napi/` | mv/unchanged |

### `src/test_runner/`

| current              | new                        | op  |
| -------------------- | -------------------------- | --- |
| `src/bun.js/test/**` | `src/test_runner/**`       | mv  |
| `src/test/`          | `src/test_runner/harness/` | mv  |

### `src/bake/`

| current       | new       | op  |
| ------------- | --------- | --- |
| `src/bake/**` | unchanged | —   |

### `src/cli/`

| current                                                      | new                   | op  |
| ------------------------------------------------------------ | --------------------- | --- |
| `src/cli.zig` (minus `Command.*`/`Arguments` → `cli_types/`) | `src/cli/cli.zig`     | mv  |
| `src/cli/*.zig`                                              | unchanged             | —   |
| `src/bunfig.zig`                                             | `src/cli/bunfig.zig`  | mv  |
| `src/repl.zig` + `src/repl/`                                 | `src/cli/repl/`       | mv  |
| `src/create/`                                                | `src/cli/create/`     | mv  |
| `src/init/`                                                  | `src/cli/init/`       | mv  |
| `src/open.zig`                                               | `src/cli/open.zig`    | mv  |
| `src/ci_info.zig`                                            | `src/cli/ci_info.zig` | mv  |

---

## 3. Absorbed (no own directory)

| candidate                                                        | disposition                                                                                                                          | reason                                                                                                     |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `fs`                                                             | `src/fs.zig`+`fs/` → `resolver/`; `tmp`/`copy_file`/`walker_skippable`/`dir` → `sys/`; `open.zig` → `cli/`                           | three distinct concerns (`fs.zig:1784-1791,1050`)                                                          |
| `transpiler`                                                     | `transpiler.zig`+`linker.zig` → `bundler/`; `runtime.zig` → `js_parser/`; `analyze_transpiled_module.zig` → `bundler/`               | (`js_parser.zig:1265`, `js_printer.zig:6386`, `PackageManager.zig:293`)                                    |
| `options`                                                        | `options.zig`/`defines*.zig`/`import_record.zig`/`cache.zig` → `bundler/`; `bunfig.zig` → `cli/`                                     | knot with `resolver`/`fs`/`js_parser`/`cli`                                                                |
| `compile_target`                                                 | `elf`/`macho`/`pe` → `exe_format/`; `StandaloneModuleGraph` reader → `standalone_graph/`; writer + `compile_target.zig` → `bundler/` | (`StandaloneModuleGraph.zig:1571`, `compile_target.zig:151`)                                               |
| `output`+`Global`+`env`+`feature_flags`+`util`+`result`          | merged into `bun_core/`                                                                                                              | mutual (`output.zig:244,903,94`, `Global.zig` reaches `jsc`/`ast`)                                         |
| `ptr`+`allocators`                                               | merged into `bun_alloc/`                                                                                                             | mutual (`safety/alloc.zig:27-36`, `MimallocArena.zig:104`, `allocation_scope.zig:306`, `memory.zig:210`)   |
| `windows`                                                        | merged into `sys/windows/`                                                                                                           | mutual with `sys`/`libuv`                                                                                  |
| `ast`+`js_parser`+`js_lexer`                                     | merged into `js_parser/`                                                                                                             | mutual (`ast/P.zig` ↔ `js_parser.zig`; `js_lexer.zig:3393,3395`)                                           |
| `s3`                                                             | `s3_signing/` (viable) + remainder → `runtime/webcore/s3/`                                                                           | `client.zig` imports `webcore/ResumableSink.zig`; `event_loop/Task.zig` enumerates `S3HttpSimpleTask`      |
| `vm`                                                             | `*.cpp` → `jsc/bindings/vm/`                                                                                                         | C++ (`NodeVM.h` ↔ `SigintWatcher.h`)                                                                       |
| `btjs`                                                           | → `jsc/btjs.zig`                                                                                                                     | 260 LOC debug-only; casts to `jsc.CallFrame`                                                               |
| `repl`                                                           | → `cli/repl/`                                                                                                                        | (`repl.zig:2036` ↔ `cli/repl_command.zig:182`)                                                             |
| `create`                                                         | → `cli/create/`                                                                                                                      | bidirectional with `create_command.zig`                                                                    |
| `init`                                                           | → `cli/init/` (embedded assets)                                                                                                      | zero Zig source                                                                                            |
| `OutputFile`                                                     | → `bundler/OutputFile.zig` (+`_jsc` split)                                                                                           | (`options.zig:2257`, `bake/production.zig`)                                                                |
| `HTMLScanner`                                                    | → `bundler/HTMLScanner.zig`                                                                                                          | only consumers: `bundler/ParseTask.zig` + linker                                                           |
| `ci_info`                                                        | `ConfigVersion.zig` → `install/`; `ci_info.zig` → `cli/`                                                                             | `ConfigVersion.zig` parses `bun.ast.Expr`, only `install` consumes                                         |
| `ParentDeathWatchdog`                                            | `SignalCode.zig` → `sys/`; `ParentDeathWatchdog.zig` → `async/`                                                                      | `FilePoll.Owner` enumerates it (cycle tolerated; resolves at port time)                                    |
| `runtime-{api,socket,server,timer,crypto,webcore,node,webview}`  | all → `runtime/` (one crate)                                                                                                         | 1458/430/841/610 JSC refs respectively; mutually entangled                                                 |
| `jsc-core`+`jsc-vm`+`event_loop` (VM-owning half)+`JSCScheduler` | merged into `jsc/`                                                                                                                   | `JSValue.zig` requires sibling opaques; 139 files import `*VirtualMachine` back; (`CallFrame.zig:213-258`) |
| `jsc-bindings-cpp`                                               | C++ static lib at `src/jsc/bindings/`                                                                                                | not a Zig/Rust crate; built via build scripts                                                              |
| `dotenv` (`env_loader.zig`)                                      | own dir at Tier 5                                                                                                                    | (was conflated with `env.zig` leaf; now split)                                                             |
| `which_npm_client`                                               | → `cli/`                                                                                                                             | only `cli` consumes                                                                                        |
| `node_fallbacks`                                                 | → `resolver/`                                                                                                                        | resolver-only consumer                                                                                     |
| `deprecated`                                                     | → `bun_core/`                                                                                                                        | —                                                                                                          |

---

## 4. `bun.zig` index

Re-export targets to update in `src/bun.zig`. Only paths that change are listed; declaration names stay the same.

| symbol                                                   | old                                                | new                                                 |
| -------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------- |
| `bun.meta`                                               | `./meta.zig`                                       | `./meta/meta.zig`                                   |
| `bun.trait`                                              | `./trait.zig`                                      | `./meta/trait.zig`                                  |
| `bun.bits`                                               | `./bits.zig`                                       | `./meta/bits.zig`                                   |
| `bun.Wyhash11`                                           | `./wyhash.zig`                                     | `./wyhash/wyhash.zig`                               |
| `bun.simdutf`                                            | `./bun.js/bindings/bun-simdutf.zig` (`:731`)       | `./simdutf_sys/simdutf.zig`                         |
| `bun.highway`                                            | `./highway.zig`                                    | `./highway/highway.zig`                             |
| `bun.darwin`                                             | `./darwin.zig`                                     | `./platform/darwin.zig`                             |
| `bun.linux`                                              | `./linux.zig`                                      | `./platform/linux.zig`                              |
| `bun.asan`                                               | `./asan.zig`                                       | `./safety/asan.zig`                                 |
| `bun.collections`                                        | `./collections.zig`                                | `./collections/collections.zig`                     |
| `bun.ComptimeStringMap` / `bun.ComptimeEnumMap`          | `./comptime_string_map.zig`                        | `./collections/comptime_string_map.zig`             |
| `bun.LinearFifo`                                         | `./linear_fifo.zig`                                | `./collections/linear_fifo.zig`                     |
| `bun.IdentityContext`                                    | `./identity_context.zig`                           | `./collections/identity_context.zig`                |
| `bun.ObjectPool`                                         | `./pool.zig`                                       | `./collections/pool.zig`                            |
| `bun.threading`                                          | `./threading.zig`                                  | `./threading/threading.zig`                         |
| `bun.WorkPool`                                           | `./work_pool.zig`                                  | `./threading/work_pool.zig`                         |
| `bun.allocators`                                         | `./allocators.zig`                                 | `./bun_alloc/bun_alloc.zig`                         |
| `bun.ptr`                                                | `./ptr.zig`                                        | `./bun_alloc/ptr.zig`                               |
| `bun.String`                                             | `./string.zig`                                     | `./string/String.zig`                               |
| `bun.Output`                                             | `./output.zig`                                     | `./bun_core/output.zig`                             |
| `bun.Global`                                             | `./Global.zig`                                     | `./bun_core/Global.zig`                             |
| `bun.Environment`                                        | `./env.zig`                                        | `./bun_core/env.zig`                                |
| `bun.FeatureFlags`                                       | `./feature_flags.zig`                              | `./bun_core/feature_flags.zig`                      |
| `bun.perf`                                               | `./perf.zig`                                       | `./perf/perf.zig`                                   |
| `bun.tracy`                                              | `./tracy.zig`                                      | `./perf/tracy.zig`                                  |
| `bun.analytics`                                          | `./analytics.zig`                                  | `./analytics/analytics.zig`                         |
| `bun.schema`                                             | `./api/schema.zig` (`:1674`)                       | `./api_schema/schema.zig`                           |
| `bun.Semver`                                             | `./semver.zig`                                     | `./semver/semver.zig`                               |
| `bun.windows`                                            | `./windows.zig`                                    | `./sys/windows/windows.zig`                         |
| `bun.windows.libuv`                                      | `./deps/libuv.zig`                                 | `./libuv_sys/libuv.zig`                             |
| `bun.sys`                                                | `./sys.zig`                                        | `./sys/sys.zig`                                     |
| `bun.FD`                                                 | `./fd.zig`                                         | `./sys/fd.zig`                                      |
| `bun.path`                                               | `./resolver/resolve_path.zig`                      | `./paths/resolve_path.zig`                          |
| `bun.paths`                                              | `./paths.zig`                                      | `./paths/paths.zig`                                 |
| `bun.crash_handler`                                      | `./crash_handler.zig`                              | `./crash_handler/crash_handler.zig`                 |
| `bun.clap`                                               | `./deps/zig-clap/clap.zig` (`:728`)                | `./clap/clap.zig`                                   |
| `bun.BoringSSL`                                          | `./boringssl.zig`                                  | `./boringssl/boringssl.zig`                         |
| `bun.sha`                                                | `./sha.zig`                                        | `./sha_hmac/sha.zig`                                |
| `bun.hmac`                                               | `./hmac.zig`                                       | `./sha_hmac/hmac.zig`                               |
| `bun.csrf`                                               | `./csrf.zig` (`:237`)                              | `./csrf/csrf.zig`                                   |
| `bun.c_ares`                                             | `./deps/c_ares.zig`                                | `./cares_sys/c_ares.zig`                            |
| `bun.zlib`                                               | `./zlib.zig`                                       | `./zlib/zlib.zig`                                   |
| `bun.brotli`                                             | `./brotli.zig` (`:2789`)                           | `./brotli/brotli.zig`                               |
| `bun.zstd`                                               | `./deps/zstd.zig` (`:1839`)                        | `./zstd/zstd.zig`                                   |
| `bun.libdeflate`                                         | `./deps/libdeflate.zig` (`:3397`)                  | `./libdeflate_sys/libdeflate.zig`                   |
| `bun.LOLHTML`                                            | `./deps/lol-html.zig` (`:727`)                     | `./lolhtml_sys/lol_html.zig`                        |
| `bun.libarchive`                                         | `./libarchive/libarchive.zig` (`:277`)             | unchanged                                           |
| `bun.base64`                                             | `./base64/base64.zig` (`:199`)                     | unchanged                                           |
| `bun.picohttp`                                           | `./deps/picohttp.zig` (`:724`)                     | `./picohttp/picohttp.zig`                           |
| `bun.uws`                                                | `./deps/uws.zig`                                   | `./uws/uws.zig`                                     |
| `bun.logger`                                             | `./logger.zig`                                     | `./logger/logger.zig`                               |
| `bun.URL`                                                | `./url.zig`                                        | `./url/url.zig`                                     |
| `bun.dns`                                                | `./dns.zig`                                        | `./dns/dns.zig`                                     |
| `bun.glob`                                               | `./glob.zig`                                       | `./glob/glob.zig`                                   |
| `bun.which`                                              | `./which.zig`                                      | `./which/which.zig`                                 |
| `bun.patch`                                              | `./patch.zig`                                      | `./patch/patch.zig`                                 |
| `bun.ini`                                                | `./ini.zig`                                        | `./ini/ini.zig`                                     |
| `bun.Watcher`                                            | `./Watcher.zig`                                    | `./watcher/Watcher.zig`                             |
| `bun.md`                                                 | `./md/md.zig` (`:241`)                             | unchanged                                           |
| `bun.interchange` / `bun.json` / `bun.toml` / `bun.yaml` | `./interchange.zig`                                | `./interchange/interchange.zig`                     |
| `bun.SourceMap`                                          | `./sourcemap/sourcemap.zig`                        | unchanged                                           |
| `bun.css`                                                | `./css/css_parser.zig`                             | unchanged                                           |
| `bun.ast` / `bun.js_parser` / `bun.js_lexer`             | `./ast.zig` / `./js_parser.zig` / `./js_lexer.zig` | `./js_parser/js_parser.zig` (re-exports all three)  |
| `bun.js_printer`                                         | `./js_printer.zig`                                 | `./js_printer/js_printer.zig`                       |
| `bun.renamer`                                            | `./renamer.zig`                                    | `./js_printer/renamer.zig`                          |
| `bun.valkey`                                             | `./valkey/index.zig`                               | unchanged (re-exports adjusted internally)          |
| `bun.http`                                               | `./http.zig`                                       | `./http/http.zig`                                   |
| `bun.Router`                                             | `./router.zig`                                     | `./router/router.zig`                               |
| `bun.resolver`                                           | `./resolver/resolver.zig`                          | unchanged                                           |
| `bun.fs`                                                 | `./fs.zig`                                         | `./resolver/fs.zig`                                 |
| `bun.DotEnv`                                             | `./env_loader.zig`                                 | `./dotenv/env_loader.zig`                           |
| `bun.options`                                            | `./options.zig`                                    | `./bundler/options.zig`                             |
| `bun.transpiler`                                         | `./transpiler.zig`                                 | `./bundler/transpiler.zig`                          |
| `bun.ImportRecord`                                       | `./import_record.zig`                              | `./bundler/import_record.zig`                       |
| `bun.install`                                            | `./install/install.zig`                            | unchanged                                           |
| `bun.install_types`                                      | (new)                                              | `./install_types/install_types.zig`                 |
| `bun.cli`                                                | `./cli.zig`                                        | `./cli/cli.zig`                                     |
| `bun.options_types.Command`                              | `./cli.zig`                                        | `./cli_types/Command.zig`                           |
| `bun.bunfig`                                             | `./bunfig.zig`                                     | `./cli/bunfig.zig`                                  |
| `bun.jsc`                                                | `./bun.js/jsc.zig`                                 | `./jsc/jsc.zig`                                     |
| `bun.api`                                                | `./bun.js/api/...`                                 | `./runtime/...`                                     |
| `bun.webcore`                                            | `./bun.js/webcore/...`                             | `./runtime/webcore/...`                             |
| `bun.Async`                                              | `./async/...`                                      | unchanged (re-exports `event_loop` for back-compat) |
| `bun.copy_file`                                          | `./copy_file.zig`                                  | `./sys/copy_file.zig`                               |
| `bun.Tmpfile`                                            | `./tmp.zig`                                        | `./sys/tmp.zig`                                     |
| `bun.DirIterator`                                        | `./dir.zig`                                        | `./sys/dir.zig`                                     |
| `bun.SignalCode`                                         | `./SignalCode.zig`                                 | `./sys/SignalCode.zig`                              |
| `bun.open`                                               | `./open.zig`                                       | `./cli/open.zig`                                    |
| `bun.tcc`                                                | `./deps/tcc.zig`                                   | `./tcc_sys/tcc.zig`                                 |
| `bun.resolve_builtins`                                   | (new)                                              | `./resolve_builtins/HardcodedModule.zig`            |

---

## 5. Build-system changes

### `build.zig`

| line       | old                                              | new                        |
| ---------- | ------------------------------------------------ | -------------------------- |
| `:966`     | `"src/deps/zlib.win32.zig"`                      | `"src/zlib_sys/win32.zig"` |
| `:967`     | `"src/deps/zlib.posix.zig"`                      | `"src/zlib_sys/posix.zig"` |
| `:977-979` | `"src/async/*_event_loop.zig"`                   | unchanged                  |
| `:522-650` | `"src/deps/uucode/…"` / `"src/unicode/uucode/…"` | unchanged                  |
| `:791`     | `b.path("src/bun.zig")`                          | unchanged                  |
| `:797`     | `b.path("src/main.zig")`                         | unchanged                  |

### `scripts/glob-sources.ts`

| field                           | change                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ---------------- | ------ | ------------------ | --------------- | ------ | ------------------ | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `zigGeneratedClasses` (`:45`)   | `["src/bun.js/*.classes.ts", "src/bun.js/{api,node,test,webcore}/*.classes.ts"]` → `["src/runtime/**/*.classes.ts", "src/jsc/*.classes.ts", "src/**/*.classes.ts"]` |
| `cxx` (`:79-95`)                | `s                                                                                                                                                                  | src/bun.js/bindings | src/jsc/bindings | g`, `s | src/bun.js/modules | src/jsc/modules | g`, `s | src/bun.js/webview | src/runtime/webview | `, add `"src/highway_sys/_.cpp"`, `"src/simdutf_sys/_.cpp"`, drop `"src/vm/_.cpp"`(now under`jsc/bindings/vm/`), `"src/deps/_.cpp"`stays until`libuwsockets\*.cpp` relocates |
| `c` (`:100-109`)                | `s                                                                                                                                                                  | src/bun.js/bindings | src/jsc/bindings | g`     |
| `js` (`:48`)                    | `"src/install/PackageManager/scanner-entry.ts"` → `"src/install_jsc/scanner-entry.ts"`                                                                              |
| `bindgen` / `bindgenV2` / `zig` | unchanged (already `src/**`)                                                                                                                                        |

### `scripts/build/flags.ts` (`:1050-1108`)

`s|src/bun.js/bindings|src/jsc/bindings|g`, `s|src/bun.js/modules|src/jsc/modules|` (10 include-dir entries + 2 file paths).

### `scripts/build/codegen.ts`

| line               | change                                                                       |
| ------------------ | ---------------------------------------------------------------------------- | ------------------- | ---------------- | ------ | ------------------ | --------------- | --- |
| `:60-61`           | `"src/bun.js/bindings/Generated*.zig"` → `"src/jsc/bindings/Generated*.zig"` |
| `:540,678,892-921` | LUT input `.cpp` paths: `s                                                   | src/bun.js/bindings | src/jsc/bindings | g`, `s | src/bun.js/modules | src/jsc/modules | `   |

### `scripts/build/bun.ts`

| line       | change                                                                                 |
| ---------- | -------------------------------------------------------------------------------------- |
| `:280`     | `"src/bun.js/bindings/root-pch.h"` → `"src/jsc/bindings/root-pch.h"`                   |
| `:312-313` | `"src/bun.js/bindings/windows/rescle*.cpp"` → `"src/jsc/bindings/windows/rescle*.cpp"` |

### `scripts/build/unified.ts` (`:53-124`)

`s|src/bun.js/bindings|src/jsc/bindings|g` across the per-TU list.

### C++ `#include` paths

```sh
git ls-files 'src/**/*.cpp' 'src/**/*.h' 'src/**/*.mm' 'src/**/*.c' \
  | xargs sed -i '' \
      -e 's|bun\.js/bindings/|jsc/bindings/|g' \
      -e 's|bun\.js/modules/|jsc/modules/|g'
```

Most includes are unqualified (`#include "root.h"`) and resolve via the include-dir list in `flags.ts`; this catches only the relative-path ones.

### `.gitignore`

`src/bun.js/bindings/Generated*.zig` → `src/jsc/bindings/Generated*.zig`.

---

## 6. Validation

Run after applying all `git mv` + `@import` fixups:

```sh
# 1. Compiles on the host
bun bd --version

# 2. Compiles on every target
bun run zig:check-all

# 3. JSC-free directories contain no JSC types
rg -l 'JSValue|JSGlobalObject|jsc\.Strong|jsc\.JSRef|CallFrame|\bJSError\b' \
  src/meta src/wyhash src/tcc_sys src/zlib_sys src/brotli_sys src/libdeflate_sys \
  src/highway_sys src/highway src/simdutf_sys src/mimalloc_sys src/platform \
  src/lolhtml_sys src/windows_sys src/libuv_sys src/boringssl_sys src/cares_sys \
  src/picohttp_sys src/uws_sys src/libarchive_sys src/string_sys \
  src/install_types src/cli_types src/resolve_builtins \
  src/safety src/collections src/threading src/bun_alloc src/string src/bun_core src/perf \
  src/analytics src/semver src/api_schema src/errno \
  src/sys src/paths src/crash_handler src/clap \
  src/boringssl src/sha_hmac src/csrf src/s3_signing src/zlib src/brotli src/zstd \
  src/libarchive src/base64 src/picohttp src/uws src/io src/async src/event_loop \
  src/logger src/url src/dns src/glob src/which src/patch src/ini src/watcher \
  src/md src/sourcemap src/css src/valkey src/js_parser src/js_printer \
  src/interchange src/exe_format src/standalone_graph \
  src/http_types src/http src/router src/resolver src/dotenv src/shell_parser \
  src/install src/bundler src/sql \
  && echo "FAIL: JSC ref leaked into a JSC-free dir" || echo "OK"

# 4. Top-level src/*.zig is the entry-point set only
find src -maxdepth 1 -name '*.zig' | sort
# expected: bun.js.zig bun.zig jsc_stub.zig main.zig main_test.zig main_wasm.zig
#           unit_test.zig workaround_missing_symbols.zig

# 5. src/bun.js/ and src/deps/ are gone (except uucode)
test -d src/bun.js && echo "FAIL: src/bun.js/ still exists"
ls src/deps/
# expected: uucode/  (libuwsockets*.cpp may remain pending relocation to uws_sys/)

# 6. Full test suite still passes (no behavior change)
bun bd test
```

---

## 7. Out of scope

- No Rust, no Cargo, no `Cargo.toml`, no workspace manifests.
- No new build system; `build.zig` + `scripts/build/*.ts` remain authoritative.
- No logic changes, no signature changes, no Shape-A opaque-owner refactors (those land per-area at Rust-port time).
- No dead-code deletion (rows with "delete" are removing redundant re-export aliases only).
- No changes to `vendor/`, `packages/`, or `test/`.
