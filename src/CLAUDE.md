## Rust

`src/` is a Cargo workspace (rooted at the repo's top-level `Cargo.toml`, ~200
member crates). The runtime is built as `libbun_runtime.a` via `cargo build -p
bun_runtime` (driven by `scripts/build/rust.ts`). Key crates:

- `bun_core` (`src/bun_core/`) — strings, formatting, logging, env vars, allocator/heap helpers, the foundation everything else uses
- `bun_sys` (`src/sys/`) — cross-platform syscall wrappers (`File`, `Fd`, `Dir`, `Error`)
- `bun_paths` (`src/paths/`) — path joining/normalization, the path-buffer pool
- `bun_jsc` (`src/jsc/`) — JSC value types, `Strong`/`Weak`, FFI imports
- `bun_runtime` (`src/runtime/`) — JS-visible APIs (server, fetch, node compat, crypto)
- `bun_js_parser`, `bun_js_printer`, `bun_resolver`, `bun_bundler`, `bun_install`, `bun_collections`, `bun_threading`, `bun_alloc` — the rest of the pipeline
- `bun_runtime::bin_entry` (`src/runtime/bin_entry/`) — the process entry point (`main`) and the
  C-ABI symbols that must be direct link inputs; `bun_runtime` itself is the
  `staticlib` that `cargo build` produces for the C++ link.

Conventions:

- `cargo check -p <crate>` for fast iteration; `bun bd` builds and links everything.
- Don't `.unwrap()` a fallible path that user input or the OS can hit at runtime — return the error. `.unwrap()` is for invariants you can prove.
- The C ABI / syscall boundary uses `bun_sys::Maybe<T>` (= `Result<T, bun_sys::Error>`); ordinary Rust code uses `Result<T, E>` with `?`.
- Each crate defines its own `Error` enum (a `thiserror::Error` at `<crate>/error.rs`, re-exported as `crate::Error` + `crate::Result`). Errno codes nest via `Sys(#[from] bun_errno::SystemErrno)`; OOM via `Alloc(#[from] bun_alloc::AllocError)`. `bun_sys::Error` is the rich syscall error (errno + syscall tag + path); `From<bun_sys::Error> for bun_errno::SystemErrno` exists for `?`-chaining.
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
to a JS exception via `bun_sys_jsc::ErrorJsc::to_js`:

```rust
use bun_sys_jsc::ErrorJsc;
match File::openat(Fd::cwd(), path, O::RDONLY, 0) {
    Ok(f) => f,
    Err(err) => return Ok(err.to_js(global)?),
}
// Internally: err.to_system_error().to_error_instance(global)
```

## Strings (`bun_core::String` and `bun_core::strings`)

`bun_core::String` is the FFI-compatible 6-variant tagged union shared with C++
(`BunString` in `BunString.cpp`). It bridges Rust and JSC and can hold a
`WTFStringImpl` (Latin-1 or UTF-16). **Latin-1 is NOT UTF-8** — bytes 128–255
are single chars in Latin-1 but invalid UTF-8 — so converting either direction
requires a real encoder, not a cast.

`String` owns one ref when WTF-backed: `Drop` derefs, `Clone` refs, it is
not `Copy`. Borrow with `&String` (or `StringView<'_>` when a by-value borrow
is needed). In an `extern "C"` signature a by-value `String` means ownership
crosses the boundary (C++ `Bun::toStringRef` return / `transferToWTFString()`
consumer); `&String` ⇔ `const BunString*`.

```rust
use bun_core::{EncodedSlice, String, Utf8Bytes};   // the only import path for all three

let s = String::clone_utf8(utf8_bytes);    // copies into a WTFStringImpl
let s = String::borrow_utf8(utf8_bytes);   // no copy; caller keeps slice alive
let s = String::static_("literal");        // 'static ASCII slice, never freed
let s = String::from_bytes(bytes);         // borrow arbitrary bytes; tags UTF-8 if non-ASCII
s.eq_ascii(b"lit") / s.starts_with_ascii(b"lit")  // encoding-aware ASCII compare without transcoding

let utf8: Utf8Bytes<'_>      = s.to_utf8();             // borrows `s` (ASCII/UTF-8) or transcodes; for locals
let utf8: Utf8Bytes<'static> = s.into_utf8();           // moves `s`'s ref in / copies; for storing in fields
let utf8: Utf8Bytes<'static> = s.clone().into_utf8();   // from `&String`: shares the WTF ref when 8-bit ASCII, else transcodes
let utf8: Utf8Bytes<'static> = x.to_utf8().into_owned(); // from a borrowed view: always an independent copy
let owned: Vec<u8>           = s.to_owned_slice();
```

Rule: a `Utf8Bytes<'static>` field/element must come from an owning producer
(`into_utf8()`, `value.to_utf8(global)?`, `x.to_utf8().into_owned()`,
`Utf8Bytes::Owned(..)`) — never from `to_utf8()` on a `&String`/`StringView`
reached through a `&'static` accessor. Prefer `s.clone().into_utf8()` when
you hold a `&String` (no copy for ASCII); use `.into_owned()` only when the
source is a bare `&[u8]`/`EncodedSlice` view.

`Utf8Bytes<'a>` is `Borrowed(&'a [u8]) | Owned(Vec<u8>) | Shared(String)`
(`Shared` holds an 8-bit all-ASCII WTF-backed `String` and reads its buffer);
it derefs to `[u8]`; `is_owned()` ⇔ the bytes were transcoded/copied.
`Utf8WithString` (`String::into_utf8_with_string[_thread_isolated]()`) keeps the
UTF-8 bytes _and_ the source `String` so the value can go back to JS without
re-encoding; `Utf8WithString::js_only(string)` wraps an output-only string.
`PathLike<'a>` / `StringOrBuffer<'a>` arms: `String`/`ThreadIsolatedString`
(`Utf8WithString` from a JS string), `Utf8(Utf8Bytes<'a>)` (transcoded JS
string, or Rust-side bytes: `PathLike::borrowed(bytes)` lends `&'a [u8]` to a
synchronous call, `PathLike::owned(vec)` when the value must own them),
`Buffer` (`PathLike`: a `PinnedArrayBuffer`, GC-rooted too when parsed for an
async call; `StringOrBuffer`: borrowed for a sync call) and
`StringOrBuffer::PinnedBuffer` (pinned and GC-rooted, parsed for an async
call). Values parsed from JS for an async call, stored, or sent to another thread (the
`from_js_async` parsers, which return `ThreadIsolated<T>`;
`PathLike::thread_isolated_copy` for a `Blob` store) is `'static`.

`EncodedSlice<'a>` is the `{ptr, len}` + encoding-bits (Latin-1/UTF-8/UTF-16)
borrowed view handed to C++. Constructors name the encoding of the bytes:
`utf8(bytes)` for Rust text (`&str`, `format!` output, anything known
UTF-8); `from_bytes(bytes)` for arbitrary bytes (OS paths, env values, user
buffers — scans and tags UTF-8 if non-ASCII); `latin1(bytes)` only for
ASCII literals / `&'static` ASCII tables, bytes already validated as ASCII,
or bytes that really are Latin-1; `utf16(units)`.
`String::to_encoded_slice()` borrows any `String` as one;
`EncodedSlice::to_utf8() -> Utf8Bytes<'a>`; `bun_jsc::EncodedSliceJsc` adds
`to_js`, `to_{,syntax_}error_instance`, `to_json_object`, and
`to_external_value` / `external` (hand a globally-allocated buffer to JSC).

Bytes → JS string: `bun_string_jsc::create_utf8_for_js(global, bytes)?`
(copies; ASCII stays 8-bit). An owned `Vec<u8>` that JS should adopt:
`bun_string_jsc::owned_utf8_into_js(global, vec)?`; an owned `Vec<u16>`:
`bun_string_jsc::owned_utf16_into_js(global, vec)?` (or `owned_latin1_into_js` for a
known-Latin-1/ASCII `Vec<u8>`); all three hand the allocation to JSC in one call. An ASCII literal or
`&'static` ASCII: `String::static_("lit").to_js(global)?`. → `Error` (each
with `type_error`/`range_error`/`syntax_error` siblings, one C++ entry):
`global.create_error_instance(format_args!(..))` (argument-free ASCII
literal → atomized; formatted → copied once), `string.to_error_instance(global)`
(WTF-backed shares the impl, static atomizes, borrowed `EncodedSlice`
copies), `EncodedSlice::utf8(bytes).to_error_instance(global)` for raw UTF-8
bytes (copied). The infallible
`EncodedSlice::…(bytes).to_js(global)` is only for callbacks that cannot
return `JsResult`, or for bytes already validated as ASCII where a rescan
is unwanted (`EncodedSlice::latin1(bytes).to_js(global)`).

JSValue → string: `value.to_bun_string(global)?` (owned `String`),
`value.to_utf8(global)?` (owned UTF-8 `Utf8Bytes<'static>`), or
`value.to_js_string_view(global)?` (borrowed `JSStringView` guard; derefs to
`&String` and keeps the `JSString` cell alive while it is in scope; its
`to_utf8()` is tied to the guard).

To/from JS values, use the `bun_jsc::StringJsc` extension trait:

```rust
use bun_jsc::StringJsc;
let js: JSValue = s.to_js(global)?;        // JS takes its own ref; `s` still usable
let js: JSValue = s.into_js(global)?;      // hands `s`'s ref to the JSString
let s = bun_core::String::from_js(value, global)?;
```

`bun_core::strings` is the SIMD-backed `&[u8]` toolkit (Google Highway kernels
with runtime CPU dispatch). Byte and substring search **must** go through it —
`str::find`/`contains`/`split*`, `slice::windows`, `memchr::*` and
`bstr::ByteSlice::find*` are denied in `clippy.toml`, and the byte-literal forms
of `<[u8]>::contains`, `iter().position/rposition/any(|b| b == b'x')` and
`.split(|b| ..)` are rejected by `test/internal/source-lints/byte-search.test.ts`:

```rust
use bun_core::strings;

strings::index_of_char_usize(s, b'x')    // Option<usize>   (not .iter().position())
strings::index_of_any(s, b"\r\n")        // Option<usize>   first byte in set
strings::last_index_of_char(s, b'x')     // Option<usize>   (not .iter().rposition())
strings::contains_char(s, b'x')          // bool            (not .contains(&b'x'))
strings::count_char(s, b'\n')            // usize
strings::index_of(haystack, needle)      // Option<usize>   substring (memmem)
strings::contains(haystack, needle)      // bool
strings::split(s, b",") / split_any(s, b" \t") / tokenize(s, b" ") / split_once_char(s, b'=')
strings::eql(a, b)                       // bool  (== / starts_with / ends_with are memcmp and fine as-is)
strings::has_prefix_comptime(s, b"x")    // 'static comparand
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

## URL Parsing (`bun_url::whatwg`)

WHATWG-compliant, backed by WebKit's URL parser. `Parsed` owns the C++
`WTF::URL` (freed on `Drop`) and derefs to `URL` for the getters; parsing
returns `None` for invalid input. `bun_jsc::url` re-exports both; the
JS-value entry points (`URL::from_js` → `Option<Parsed>`, `URL::href_from_js`)
come from the `bun_jsc::URLJsc` trait.

```rust
use bun_url::whatwg::Parsed;

let url: Parsed = Parsed::from_utf8(href)?;       // or Parsed::from_string(&bun_string)?

url.protocol()   // bun_core::String
url.pathname()   // bun_core::String
url.host()       // bun_core::String — the hostname WITHOUT the port (opposite of JS `host`!)
url.hostname()   // bun_core::String — the host WITH the port (opposite of JS `hostname`!)
url.port()       // u32 (u32::MAX = unset; otherwise u16 range)
```

`bun_url::href_from_string`, `file_url_from_string`, `path_from_file_url`,
`join` do whole-string conversions.

## MIME Types (`bun_http_types::MimeType`)

```rust
use bun_http_types::{MimeType, mime_type};

let mime = mime_type::by_extension(b"html");            // MimeType
let mime = mime_type::by_extension_no_default(b"xyz");  // Option<MimeType>

mime.category   // Category::Javascript | Css | Html | Json | Image | Text | Wasm | ...
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

`StringImpl` refcounts are atomic; two things are per-thread: using a string as
a property key (`Identifier::fromString`) atomizes a non-atom impl _in place_
into the current thread's atom table, and the last `deref()` of an atom removes
it from the _current_ thread's table (`RELEASE_ASSERT(wasRemoved)`). The lazily
computed hash/flags word is also unsynchronized. Rules:

- Handing a value to one other thread (work pool, HTTP thread):
  `String::thread_isolated_copy()`, `ThreadIsolated<T>`, or own bytes
  (`Box<[u8]>`, `clone_utf8` on arrival).
- Letting several VMs reach one impl (process-global registry, one
  `SerializedScriptValue` with many receivers): `String::make_thread_shareable()`
  (C++ `Bun::makeThreadShareable` / `threadShareableCopy` /
  `toCrossThreadShareable`) once — pre-hashed, never atomized in place, so each
  receiver's atom table takes its own copy — then hand out plain `clone()`s.
  Static strings already qualify.

Worked examples: `ObjectURLRegistry`, `StandaloneModuleGraph::File`, the
structured-clone object fast paths.

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
