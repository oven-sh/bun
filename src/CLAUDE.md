## Rust

`src/` is a Cargo workspace (rooted at the repo's top-level `Cargo.toml`, ~200
member crates). The runtime is built as `libbun_rust.a` via `cargo build -p
bun_bin` (driven by `scripts/build/rust.ts`). Key crates:

- `bun_core` (`src/bun_core/`) — strings, formatting, logging, env vars, allocator/heap helpers, the foundation everything else uses
- `bun_sys` (`src/sys/`) — cross-platform syscall wrappers (`File`, `Fd`, `Dir`, `Error`)
- `bun_paths` (`src/paths/`) — path joining/normalization, the path-buffer pool
- `bun_jsc` (`src/jsc/`) — JSC value types, `Strong`/`Weak`, FFI imports, `URL`
- `bun_runtime` (`src/runtime/`) — JS-visible APIs (server, fetch, node compat, crypto)
- `bun_js_parser`, `bun_js_printer`, `bun_resolver`, `bun_bundler`, `bun_install`, `bun_collections`, `bun_threading`, `bun_alloc` — the rest of the pipeline
- `bun_bin` (`src/bun_bin/`) — the staticlib root that `cargo build` links

You will see `.zig` siblings next to many `.rs` files — those are the original
implementation kept as a porting reference for _behavior_; they are not
compiled and are not where new code goes.

Conventions:

- `cargo check -p <crate>` for fast iteration; `bun bd` builds and links everything.
- Don't `.unwrap()` a fallible path that user input or the OS can hit at runtime — return the error. `.unwrap()` is for invariants you can prove.
- The C ABI / syscall boundary uses `bun_sys::Maybe<T>` (= `Result<T, bun_sys::Error>`); ordinary Rust code uses `Result<T, E>` with `?`.
- `bun_core::Error` is a lightweight interned `NonZeroU16` error code; `bun_sys::Error` is the rich syscall error (errno + syscall tag + path). `From<bun_sys::Error> for bun_core::Error` exists.
- NEVER add comments to deleted code blocks.
- Do not add comments that reference context from the transcript.
- Avoid adding comments where not necessary.

## Prefer `bun_core` / `bun_sys` over `std`

The `std` equivalents either lose OS error info, allocate where we have pools,
or don't match the cross-platform behavior the runtime needs.

| Instead of                              | Use                                                                                  |
| --------------------------------------- | ------------------------------------------------------------------------------------ |
| `std::fs::File`                         | `bun_sys::File` (owns the fd; closes on `Drop`)                                      |
| `std::fs::read` / `write`               | `bun_sys::File::read_from` / `File::create` + `write_all`                            |
| `std::path::Path::join`                 | `bun_paths::resolve_path::join` / `join_string_buf`                                  |
| `std::path::Path::parent`/`file_name`   | `bun_paths::dirname` / `bun_paths::basename`                                         |
| `std::env::var`                         | `bun_core::env_var::*::get()` (typed + cached)                                       |
| `String::from_utf8` for JS-visible strs | `bun_core::String::clone_utf8` / `borrow_utf8`                                       |
| `&str` operations on byte slices        | `bun_core::strings::*` (SIMD-backed `&[u8]` ops)                                     |
| `eprintln!` for debug logging           | `bun_core::declare_scope!` + `scoped_log!`                                           |
| `std::process::Command`                 | `bun_core::util::spawn_sync_inherit` (CLI helpers) or `bun_spawn_sys` (full control) |
| `Box::new` + raw ptr round-trip         | `bun_core::heap::{into_raw, take, destroy}`                                          |

## `bun_sys` — System Calls (`src/sys/`)

Syscall wrappers preserve errno via `Maybe<T> = Result<T, bun_sys::Error>`.

```rust
use bun_sys::{File, Fd, O};

let file = File::openat(Fd::cwd(), b"path/to/file", O::RDONLY, 0)?;
let mut buf = vec![0u8; 4096];
let n = file.read_all(&mut buf)?;     // loops until EOF or full
// `file` closes on Drop.
```

Key types and functions:

- `Fd` (`bun_core::Fd`, re-exported) — cross-platform file descriptor. `Fd::cwd()`, `Fd::stdin()/stdout()/stderr()`, `fd.close()`.
- `File::open(path: &ZStr, flags, mode)` / `File::openat(dir: Fd, path: &[u8], flags, mode)` / `File::make_open(...)` (creates parent dirs) / `File::create(dir, path, truncate)`
- `file.read(buf)` / `read_all(buf)` / `read_to_end()` / `read_to_end_small()` / `write(buf)` / `write_all(buf)`
- `bun_sys::open`, `read`, `write`, `pread`, `pwrite`, `stat`, `fstat`, `lstat`, `mkdir`, `unlink`, `rename`, `symlink`, `chmod` — free fns over `Fd`
- Open flags: `bun_sys::O::RDONLY`, `O::WRONLY | O::CREAT | O::TRUNC`, etc.

`bun_sys::Error` carries `errno`, `syscall: Tag`, `path: Box<[u8]>`. Convert
to a JS exception via `bun_jsc::ErrorJsc::to_js`:

```rust
use bun_jsc::ErrorJsc;
match File::openat(Fd::cwd(), path, O::RDONLY, 0) {
    Ok(f) => f,
    Err(err) => return Ok(err.to_js(global)?),
}
// Internally: err.to_system_error().to_error_instance(global)
```

## Strings (`bun_core::String` and `bun_core::strings`)

`bun_core::String` is the FFI-compatible 5-variant tagged union shared with C++
(`BunString` in `BunString.cpp`). It bridges Rust and JSC and can hold a
`WTFStringImpl` (Latin-1 or UTF-16). **Latin-1 is NOT UTF-8** — bytes 128–255
are single chars in Latin-1 but invalid UTF-8 — so converting either direction
requires a real encoder, not a cast.

```rust
use bun_core::String;

let s = String::clone_utf8(utf8_bytes);    // copies into a WTFStringImpl
let s = String::borrow_utf8(utf8_bytes);   // no copy; caller keeps slice alive
let s = String::static_(b"literal");       // 'static slice, never freed

let utf8: ZigStringSlice = s.to_utf8();    // ref-holding view; falls back to allocating a copy
let owned: Vec<u8>       = s.to_utf8_bytes();
```

To/from JS values, use the `bun_jsc::StringJsc` extension trait:

```rust
use bun_jsc::StringJsc;
let js: JSValue = s.to_js(global)?;
let s = bun_core::String::from_js(value, global)?;
let err = s.to_error_instance(global);
```

`bun_core::strings` is the SIMD-backed `&[u8]` toolkit. Use it instead of
`std::str` / `std::iter` for searching and comparing byte slices:

```rust
use bun_core::strings;

strings::index_of(haystack, needle)      // Option<usize>
strings::contains(haystack, needle)      // bool
strings::eql(a, b)                       // bool
strings::starts_with(s, prefix)          // bool
strings::ends_with(s, suffix)            // bool
strings::has_prefix_comptime(s, b"x")    // 'static comparand
strings::has_suffix_comptime(s, b"x")
strings::first_non_ascii(s)              // Option<u32>
strings::to_utf16_alloc(...)             // encoding conversions
```

## Paths (`bun_paths`)

Path helpers operate on `&[u8]` and are platform-parameterized via the
`Platform` const-generic (`Posix`, `Windows`, `Loose`, `Nt`; `platform::Auto`
picks the host). Never use `std::path` for runtime path logic.

```rust
use bun_paths::{dirname, basename};
use bun_paths::resolve_path::{self, platform};

let dir  = dirname(path);                               // Option<&[u8]>
let name = basename(path);                              // &[u8]
let joined = resolve_path::join::<platform::Auto>(&[a, b]);   // &'static [u8] (threadlocal buf)
let joined = resolve_path::join_string_buf::<platform::Auto>(&mut buf, &[a, b]);  // caller buf
let rel    = resolve_path::relative(from, to);
```

Use the path-buffer pool to avoid 64 KB stack allocations on Windows
(`PathBuffer` is `[u8; PATH_MAX_BYTES]`, ~64 KB on Windows):

```rust
use bun_paths::path_buffer_pool;

let mut buf = path_buffer_pool::get();        // PoolGuard<PathBuffer>, returns to pool on Drop
let joined  = resolve_path::join_string_buf::<platform::Auto>(&mut *buf, &[a, b]);
```

`bun_paths::os_path_buffer_pool` selects the wide (`u16`) variant on Windows
and the narrow (`u8`) variant on POSIX.

## URL Parsing (`bun_jsc::URL`)

WHATWG-compliant, backed by WebKit's URL parser. Returns `None` for invalid input.

```rust
use bun_jsc::URL;

let url = URL::from_utf8(href)?;                  // Option<NonNull<URL>>
// caller owns the C++ object — destroy it when done:
// unsafe { URL::destroy(url.as_ptr()) }

url.protocol()   // bun_core::String
url.pathname()   // bun_core::String
url.search()     // bun_core::String
url.port()       // u32 (u32::MAX = unset; otherwise u16 range)

// NOTE: host()/hostname() are SWAPPED relative to JS:
url.host()       // hostname WITHOUT port  (opposite of JS!)
url.hostname()   // hostname WITH port     (opposite of JS!)
```

`URL::href_from_string`, `URL::file_url_from_string`, `URL::path_from_file_url`
do whole-string conversions.

## MIME Types (`bun_http_types::MimeType`)

```rust
use bun_http_types::{MimeType, mime_type};

let mime = mime_type::by_extension(b"html");            // MimeType
let mime = mime_type::by_extension_no_default(b"xyz");  // Option<MimeType>

mime.category   // Category::Javascript | Css | Html | Json | Image | Text | Wasm | ...
mime.category.is_text_like()
```

Common constants: `JAVASCRIPT`, `JSON`, `HTML`, `CSS`, `TEXT`, `WASM`, `ICO`, `OTHER`.

## Memory & Allocators

The `#[global_allocator]` is mimalloc (or `std::alloc::System` under
`cfg(bun_asan)`), so plain `Box`/`Vec`/`String` already use it. When pairing
with C/C++ that may free the bytes, route through `bun_alloc::default_alloc`
rather than `mi_*` directly — under ASAN the global allocator is libc's, so a
`mi_free`/`mi_usable_size` on `Box`-owned memory is an allocator mismatch.

OOM handling: do not let a runtime OOM unwind into FFI. Use
`bun_core::handle_oom` (or the `.unwrap_or_oom()` extension) to convert
`Result<T, AllocError>` into a controlled crash:

```rust
use bun_core::{handle_oom, UnwrapOrOom};
let buf = handle_oom(allocator.alloc(size));
let v   = vec.try_reserve(n).unwrap_or_oom();
```

Heap round-trips that need to cross FFI use `bun_core::heap`:

```rust
use bun_core::heap;
let raw: *mut T = heap::into_raw(Box::new(value));    // hand ownership to C
let boxed: Box<T> = unsafe { heap::take(raw) };       // reclaim ownership
unsafe { heap::destroy(raw) };                        // reclaim + drop in one step
```

**Arena gotcha:** values allocated in `bun_alloc::MimallocArena` (the AST
allocator and similar) do **not** run `Drop` when the arena resets — the
backing pages are bulk-freed. If a type owns a heap allocation, refcount, or
fd, free it explicitly before the arena resets. Don't rely on `Drop` for
correctness in arena-backed code.

## Environment Variables (`bun_core::env_var`)

Typed, cached accessors. Each known env var is a module with a `get()`
returning the right type (`Option<...>` if no default).

```rust
use bun_core::env_var;

env_var::HOME::get()                                 // Option<&[u8]>
env_var::CI::get()                                   // bool (has default)
env_var::BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS::get()  // u64 (has default)
```

## Logging (`bun_core::output`)

Scoped debug logging. Declare a scope once per module; gate with
`BUN_DEBUG_<SCOPE>=1` at runtime; the body dead-strips in release builds.

```rust
bun_core::declare_scope!(my_feature, hidden);   // hidden: opt-in via BUN_DEBUG_my_feature=1
// or `visible` to log by default in debug builds

bun_core::scoped_log!(my_feature, "processing {} items", count);
```

User-facing colored output (auto-detects TTY, strips ANSI when piped):

```rust
bun_core::pretty!("<green>success<r>: {}\n", msg);
bun_core::prettyln!("done");
bun_core::pretty_errorln!("<red>error<r>: {}", msg);
```

## Spawning Subprocesses

For simple inherit-stdio CLI helpers:

```rust
use bun_core::util::spawn_sync_inherit;
let status = spawn_sync_inherit(&[b"git", b"status"])?;
```

For full control (pipes, custom env, posix_spawn flags) use `bun_spawn_sys`
(`src/spawn_sys/`). The runtime `Bun.spawn` implementation lives in
`src/runtime/api/bun/{spawn.rs, process.rs, subprocess.rs}` — look there for
the JS-facing path.

## JSC Interop & FFI Safety

These are the patterns that trip people up. Get them wrong and you get
crashes that only reproduce under load or in CI.

### Pointer provenance at FFI boundaries

If a callback may free `self` (close, error, GC finalize), do **not**
materialize `&self`/`&mut self` at the boundary — a `&self`-derived raw
pointer carries `SharedReadOnly` provenance, and `Box::from_raw`/dealloc
through it is UB. Pass and dispatch off `*mut Self` until the body proves
ownership. `src/io/PipeWriter.rs`'s `impl_streaming_writer_parent!` macro
encodes the three modes:

- `borrow = mut` — body forms `&mut *this`; safe when nothing re-enters
- `borrow = shared` — body forms `&*this`; safe when re-entrant code only needs `&Self`
- `borrow = ptr` — body calls `Self::method(this, ..)` with `this: *mut Self`; required when the callback may free `self`

### `Strong` / `Weak` JS handles

`bun_jsc::Strong` keeps a JS value alive; it is `!Send`/`!Sync` and must be
created and dropped on the JS thread.

```rust
use bun_jsc::Strong;
let strong = Strong::create(value, global);
let v: JSValue = strong.get();
// drop(strong) releases the GC handle
```

`bun_jsc::Weak<T>` is the GC-cleared variant. For raw values without a `Strong`
wrapper, `JSValue::protect()` / `unprotect()` and `ensure_still_alive()` are
available, but `Strong` is preferred — it can't be forgotten or unbalanced.

### Refcount transfer on `to_js()` / `create()`

A `to_js()` / `create()` that returns a wrapped pointer **transfers** the
caller's `+1` to the JS wrapper. Do not `ref()` again before the return; the
finalizer derefs once. The leak-or-UAF symptoms of getting this wrong are
distinctive: an extra `ref()` leaks until process exit; a missing `ref()` on a
non-transferring path UAFs at GC.

### Cross-thread string hazards

`AtomString`s live in a per-thread table. Never deref one from another thread —
it trips `wasRemoved` in `AtomStringImpl::remove()`. If a `bun_core::String`
may be dropped from a non-JS thread (HTTP worker, threadpool, dying VM), build
it via `String::clone_utf8` (a plain `WTFStringImpl` with an atomic refcount),
not from an interned/atomized JS string. See the comment in
`src/runtime/webcore/fetch/FetchTasklet.rs` near `Response::init` for the
canonical example of this bug class and its fix.

## Common Patterns

```rust
// Read a file, return JS error on failure
let contents = match bun_sys::File::openat(Fd::cwd(), path, O::RDONLY, 0)
    .and_then(|f| f.read_to_end())
{
    Ok(bytes) => bytes,
    Err(err) => return Ok(err.to_js(global)?),
};

// Heap-allocated FFI handle with explicit lifecycle
let raw = bun_core::heap::into_raw(Box::new(MyHandle::new()));
register_with_c(raw);
// ... later, in the matching teardown callback:
unsafe { bun_core::heap::destroy(raw) };

// Hashing
bun_wyhash::hash(bytes)            // u64
bun_wyhash::hash_with_seed(seed, bytes)
```

## OHOS (HarmonyOS) 移植说明

### 构建方式

```bash
bun run build:release --target=aarch64-linux-ohos \
  --sysroot=/path/to/ohos-sdk/sysroot
```

### 构建配置

- **链接方式**: PIE + 动态链接 `libc.so` + 静态 `libc++.a`
- **交叉编译器**: `aarch64-linux-ohos-clang`

### ✅ 已修复问题

| 问题 | 修复方式 | 提交 |
|------|----------|------|
| `spawnSync({stdout:'pipe'})` 输出为空 | 跳过 `wait_linux_signalfd`（prctl/pidfd 使 wait_linux_signalfd 路径阻塞），改用 `poll()+wait4()` | `a532c50ee4` |
| `fchmodat2` (#452) SIGSYS 噪声 | `#[cfg(target_env = "ohos")]` 跳过，直接走 `fchmodat` fallback | `fd3456e10c` |
| `sys::dlopen()` / FFI 不可用 | 动态链接 `libc.so` | `8f92231b33` |
| `CouldntReadCurrentDirectory` | `run_command.rs` 静默处理 EPERM/EACCES | `c4d2db7bf4` |
| Hardlinker EPERM copy 缺父目录 | copy fallback 前创建父目录 | `fd3456e10c` |
| PackageInstall symlinkat EPERM | copy_file 回退 | `a976e9bb09` |
| 测试超时安全网 | SIGALRM + 两级看门狗 SIGTERM→SIGKILL | `a976e9bb09` |

### 已验证的 OHOS 系统限制（2026-06-07 真机验证）

> 验证程序: `ohos-limits-verify.c`，结果详见 `ohos-limits-verification-20260607.md`

| 限制 | 影响 | 验证结果 |
|:-----|:------|:---------|
| `link()` 硬链接 EPERM | `bun install` 软链包失败（需 copy fallback）| ✅ EPERM 确认 |
| `close_range` 被 seccomp 拦截 | `bun_close_range()` 返回 ENOSYS | ✅ SIGSYS(436) |
| `openat2` 被 seccomp 拦截 | `#[cfg(ohos)]` 提前返回 ENOSYS | ✅ SIGSYS(437) |
| `fchmodat2` 被 seccomp 拦截 | cfg skip → `fchmodat` fallback | ✅ SIGSYS(452) |
| `/tmp` 只读 | 临时文件创建失败 | ✅ EROFS（$TMPDIR 回退正常）|
| 二进制需签名 | 启动前需 `binary-sign-tool sign` | ✅ 已自动化 |
| `process.dlopen` ABI 不匹配 | 无法加载预编译 .node | ✅ 需 OHOS SDK 重编 |


### 已测试但未受限制（False Positive 已删除）

以下条目曾记录为 OHOS 限制，经真机验证确认不受限：

| 条目 | 之前记录 | 实测结果 |
|:-----|:---------|:---------|
| 多线程 fork 后 fd | 不可用 | ✅ **全部可用**（pipe/socket/PTY/epoll/eventfd）|
| prctl SET_PDEATHSIG | 被拦截 | ✅ **可用** |
| prctl SET_CHILD_SUBREAPER | 被拦截 | ✅ **可用** |
| fstat on pipe/socket | EACCES | ✅ **正常** |
| PTY spawn 输出 | 为空 | ✅ **正常输出** "mt-pty-ok" |
| pidfd_open | 被拦截 | ⚠️ **可用**（返回 fd）|
| memfd_create | 被拦截 | ⚠️ **可用**（返回 fd）|
| copy_file_range | 被拦截 | ⚠️ **可用**（rc=16，成功复制 16 字节）|
| process_vm_readv | 被拦截 | ⚠️ **可用** |

### 已确认被 seccomp 拦截的 syscall

| syscall | 编号 | 验证方式 |
|:--------|:-----|:---------|
| `close_range` | 436 | SIGSYS ✅ |
| `openat2` | 437 | SIGSYS ✅ |
| `fchmodat2` | 452 | SIGSYS ✅ |

与标准 Linux 不同的 OHOS syscall 编号：`memfd_create`=279（非 319），`process_vm_readv`=270（非 310）。Bun 代码中使用 `SYS_*` 宏自动适配。

### spawn 实现说明

- **spawnSync**: `wait_linux_signalfd` 被 bypass（原因: 路径中使用 `prctl` + `pidfd_open` 在 OHOS 上无法正常工作）。改用 `poll(pipe_fds) + wait4()` 循环。
- **no_orphans**: prctl 可用但 `wait_linux_signalfd` bypass 后级联清理路径断开。`--no-orphans` 功能降级。
- **PIDFD**: pidfd_open 实际可用，`BUN_OHOS_DISABLE_PIDFD` 标志可考虑移除。

### 测试结果

全量测试（2026-06-07, 1,753 files, PARALLEL=6, RETRIES=3）:

| 级别 | 通过 | 失败 |
|:-----|:-----|:-----|
| 文件级 | 1,426 (81.3%) | 327 |
| 用例级（去重后） | 50,971 (95.6%) | 2,343 |
| SIGSEGV | **0** | ✅ |

主要失败原因：EPERM link（security scanner）、超时、网络环境、第三方库缺失。

