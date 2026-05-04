# Zig → Rust porting guide

You are translating one Zig file to Rust. Read this whole document before
writing any code. The goal of Phase A is a **draft** `.rs` next to the `.zig`
that captures the logic faithfully — it does **not** need to compile. Phase B
makes it compile crate-by-crate.

## Ground rules

- **Write the `.rs` in the same directory as the `.zig`, same basename.**
  `<area>` is always the **first path component under `src/`** (the crate
  root). If the `.zig` basename equals its **immediate** parent directory name
  (any depth), name it `mod.rs`; if it equals the top-level `<area>` dir, name
  it `lib.rs`. Examples: `src/bake/DevServer/HmrSocket.zig` →
  `src/bake/DevServer/HmrSocket.rs`; `src/bake/DevServer/DevServer.zig` →
  `src/bake/DevServer/mod.rs`; `src/http/http.zig` → `src/http/lib.rs`.
- **Do not invent crate layouts.** Cross-area types are referenced as
  `bun_<area>::Type` (see crate map below). Phase B wires the `Cargo.toml`.
- **No `tokio`, `rayon`, `hyper`, `async-trait`, `futures`.** No `std::fs`,
  `std::net`, `std::process`. Bun owns its event loop and syscalls. (Rust
  `core`/`std` slice, iter, mem, fmt, and `core::ffi` are fine — only the
  I/O-touching modules are banned.)
- **No `async fn`.** Everything is callbacks + state machines, same as the Zig.
- **`unsafe` is fine when the Zig was already unsafe.** Annotate every block
  with `// SAFETY: <why>` mirroring the Zig invariant.
- **Leave `// TODO(port): <reason>` for anything you can't translate
  confidently.** Don't guess. Flagging is better than wrong code.
- **Leave `// PERF(port): <zig idiom> — profile in Phase B`** wherever the Zig
  used a perf-specific idiom (`appendAssumeCapacity`, arena bulk-free,
  stack-fallback alloc, comptime monomorphization) and the port uses the plain
  idiomatic form. Phase A optimizes for correctness+idiom; Phase B greps
  `PERF(port)` and benchmarks.
- **Match the Zig's structure.** Same fn names (snake_case), same field order,
  same control flow. Phase B reviewers diff `.zig` ↔ `.rs` side-by-side.
  Acronyms collapse to one lowercase word: `toAPI`→`to_api`, `isCSS`→`is_css`,
  `toUTF8`→`to_utf8`, `toJS`→`to_js`, `errorInCI`→`error_in_ci`. Rule: a run
  of ≥2 uppercase letters is one segment.
  **Exception — out-param constructors.** `fn foo(this: *@This(), ...) !void`
  whose body assigns `this.* = .{...}` → `fn foo(...) -> Result<Self, E>`. Zig
  uses out-params because it lacks guaranteed NRVO for error unions; Rust does
  not. Diff readers should expect this reshape. If `this` is a pre-allocated
  slot in a pool/array (in-place init to avoid a move), keep
  `&mut MaybeUninit<Self>` and flag `// TODO(port): in-place init`.
  **Exception — `deinit`.** `pub fn deinit` becomes `impl Drop`, not an
  inherent method named `deinit` (see Idiom map).
- **Borrow-checker reshaping is allowed.** When matching Zig flow yields
  overlapping `&mut`, capture the needed scalar (`.len()`, index) into a local,
  drop the borrow, then re-borrow. Do NOT reach for raw pointers just to
  silence borrowck; leave `// PORT NOTE: reshaped for borrowck` so Phase B
  diff readers aren't confused.
- **Prereq for every crate:** `#[global_allocator] static ALLOC: bun_alloc::Mimalloc = bun_alloc::Mimalloc;`
  must be set at the binary root before any `Box`/`Rc`/`Arc`/`Vec` mapping in
  this guide is valid — otherwise you silently switch from mimalloc to glibc
  malloc. Phase B asserts this; Phase A can assume it.

## Crate map

`@import("bun").X` → look up `X` here. `@import("../<area>/file.zig")` →
`bun_<area>::file::Thing`.

| Zig namespace | Rust crate | notes |
|---|---|---|
| `bun.String`, `bun.strings`, `ZigString` | `bun_str` | `bun_str::String`, `bun_str::strings::*` |
| `bun.sys`, `bun.FD`, `Maybe(T)` | `bun_sys` | `bun_sys::Result<T>`, `bun_sys::Fd` |
| `bun.jsc`, `JSValue`, `JSGlobalObject`, `CallFrame`, `JSRef`, `Strong` | `bun_jsc` | see "JSC types" |
| `bun.uws`, `us_socket_t`, `Loop` | `bun_uws_sys` (raw) / `bun_uws` (wrappers) | |
| `bun.Output`, `bun.Global`, `bun.fmt`, `bun.env_var` | `bun_core` | |
| `bun.allocators`, `MimallocArena`, `bun.default_allocator` | `bun_alloc` | see "Allocators" |
| `bun.ptr.*` (`Owned`, `Shared`, `AtomicShared`, `RefCount`, `TaggedPointer`, `WeakPtr`) | **std** / `bun_collections` | `Box`, `Rc`, `Arc`, see "Pointers" |
| `bun.http` | `bun_http` | |
| `bun.Async`, `FilePoll`, `KeepAlive` | `bun_aio` | |
| `bun.threading`, `ThreadPool` | `bun_threading` | |
| `bun.jsc.WorkPool` | `bun_threading::WorkPool` | not under `bun.threading` in Zig |
| `bun.logger` | `bun_logger` | |
| `bun.ast`, `js_parser`, `js_lexer`, `Expr`, `Stmt` | `bun_js_parser` | |
| `bun.ImportRecord`, `bun.ImportKind` (`src/options_types/`) | `bun_options_types` | |
| `bun.options`, `bun.options.Loader` (`src/bundler/options.zig`) | `bun_bundler::options` | |
| `bun.Semver` | `bun_semver` | |
| `bun.glob` | `bun_glob` | |
| `bun.path`, `resolve_path` | `bun_paths` | |
| `bun.PathBuffer`, `bun.WPathBuffer`, `bun.OSPathBuffer`, `bun.MAX_PATH_BYTES`, `bun.path_buffer_pool`, `bun.w_path_buffer_pool` | `bun_paths` | `bun_paths::PathBuffer` (= `[u8; MAX_PATH_BYTES]`), `bun_paths::path_buffer_pool()` returns RAII guard |
| `std.fs.path.sep` / `sep_str` / `delimiter` / `isAbsolute` | `bun_paths` | `bun_paths::SEP: u8`, `SEP_STR: &str`, `DELIMITER: u8`, `is_absolute(&[u8])` — do NOT use `std::path` (operates on `OsStr`, wrong type) |
| `bun.windows`, `bun.c`, `bun.darwin`, `bun.linux` | `bun_sys::windows` etc. | `bun.c` is `translated-c-headers` |
| `bun.hash(...)` | `bun_wyhash::hash` | wraps **`std.hash.Wyhash`** (seed 0), NOT `Wyhash11` |
| `bun.Wyhash11` | `bun_wyhash::Wyhash11` | distinct algorithm; do not conflate with `bun.hash` |
| `bun.BoringSSL` | `bun_boringssl` (+ `bun_boringssl_sys`) | |
| `bun.shell` | `bun_shell` | arena+NodeId, see plan |
| `bun.bake` | `bun_bake` | |
| `bun.install` | `bun_install` | |
| `bun.bundle_v2`, `Transpiler` | `bun_bundler` | |
| `std.ArrayList`, `std.AutoHashMap`, `MultiArrayList`, `BabyList` | `bun_collections` or std | see "Collections" |

If it's not in this table: the crate is `bun_<top>` where `<top>` is the
**first** directory under `src/` (verbatim — `crash_handler` →
`bun_crash_handler`, `bun_alloc` stays `bun_alloc`, no double prefix).
Intermediate directories become module path segments, snake_cased:
`src/bake/DevServer/Assets.zig` → `bun_bake::dev_server::Assets`.

## Type map

`c_int`, `c_char`, `c_void` come from `core::ffi::*` — they are not in the
prelude.

| Zig | Rust | notes |
|---|---|---|
| `[]const u8` | **fn param/return** → `&[u8]`. **Struct field** → look at `deinit` in this file: if it calls `allocator.free(self.field)` → `Box<[u8]>` (or `Vec<u8>` if it grows); if never freed and only ever assigned literals → `&'static [u8]`; if arena-owned (CSS/parser) → raw `*const [u8]` / `StoreRef` (see Allocators). Same split applies to `[]const T` generally. | never put a lifetime param on a struct in Phase A — `Box` vs `&'static` vs raw is the decision |
| `[]u8` | `&mut [u8]` | |
| `[:0]const u8` | `&ZStr` (`bun_str::ZStr`) | length-carrying NUL-terminated slice |
| `[:0]u8` | `&mut ZStr` (`bun_str::ZStr`) | length-carrying NUL-terminated mutable slice |
| `[:0]const u16` | `&bun_str::WStr` | length-carrying NUL-terminated UTF-16 slice |
| `[:0]u16` | `&mut bun_str::WStr` | |
| `[*:0]const u8` | `*const c_char` in `extern "C"` signatures and `#[repr(C)]` fields; `&CStr` everywhere else (fn params/returns inside Rust) | convert at the FFI boundary with `CStr::from_ptr` |
| `?T` | `Option<T>` | |
| `?*T` / `*T` / `*const T` **struct field** | **look it up in `docs/LIFETIMES.tsv`** (cols: file·struct·field·zig_type·class·rust_type·evidence) and use the `rust_type` column verbatim. Classes: OWNED→`Box<T>`, SHARED→`Rc/Arc<T>`, BORROW_PARAM→`&'a T` (struct gets `<'a>`), STATIC→`&'static T`, JSC_BORROW→`&JSGlobalObject` etc., BACKREF/INTRUSIVE/FFI→raw `*const`/`*mut T`, ARENA→`&'bump T`, UNKNOWN→`Option<NonNull<T>>` + `// TODO(port): lifetime`. | the TSV is pre-computed cross-file analysis; trust it over local guessing |
| `?*T` / `*T` / `*const T` **fn param/return** (not a field) | `Option<&T>` / `&mut T` / `&T` | raw ptr only at `extern "C"` boundary |
| `anyopaque` | `core::ffi::c_void` | |
| `anyerror!T` | `Result<T, bun_core::Error>` | **always** in Phase A. `bun_core::Error` is **not an enum**: `#[repr(transparent)] #[derive(Copy, Clone, Eq, PartialEq, Hash)] pub struct Error(NonZeroU16)` with a link-time-registered name table; `bun_core::err!("ENOENT")` interns the tag and yields a `const Error`; `.name() -> &'static str` returns the exact Zig tag. Every per-crate `thiserror` enum auto-derives `Into<bun_core::Error>`. **Never** `anyhow::Error` / `Box<dyn Error>` — heap-allocates, `!Copy`, breaks `@errorName` snapshot compat and the 77 struct fields that store bare errors. Phase B narrows to local enums where the call graph permits. |
| `!T` (inferred error set) | `Result<T, bun_core::Error>` | same as `anyerror!T` in Phase A; leave `// TODO(port): narrow error set`. Exception: if the body's only `try` sites are allocations, use `Result<T, bun_alloc::AllocError>` directly. |
| `anyerror` (bare value: field/param/local) | `bun_core::Error` | the `Copy` `NonZeroU16` newtype above. Never `Box<dyn Error>` / `anyhow::Error` — Zig errors carry no payload; a fat trait object loses `Copy`/`Eq` and cannot live in `#[repr(C)]` payloads. |
| `OOM!T` / `bun.OOM!T` / `error{OutOfMemory}!T` | `Result<T, bun_alloc::AllocError>` | re-exported as `bun_core::OOM`; `From<AllocError> for bun_core::Error` and `for bun_jsc::JsError` provided. `bun.JSOOM!T` → `bun_jsc::JsResult<T>` (`JsError` already has `OutOfMemory`). |
| `error{A,B}!T` | `Result<T, FooError>` where `#[derive(thiserror::Error, strum::IntoStaticStr)] enum FooError { A, B }` | `IntoStaticStr` provides the `@errorName` string; impl `From<FooError> for bun_core::Error`. |
| `bun.JSError!T` | `bun_jsc::JsResult<T>` | |
| `Maybe(T)` (`bun.sys`) | `bun_sys::Result<T>` | tagged `{ Ok(T), Err(SysError) }` |
| `JSC.JSValue` | `bun_jsc::JSValue` | `#[repr(transparent)] i64`, `Copy`, `!Send` |
| `*JSC.JSGlobalObject` | `&bun_jsc::JSGlobalObject` | always borrowed, never owned |
| `JSC.CallFrame` | `&bun_jsc::CallFrame` | |
| `bun.String` | `bun_str::String` | see "Strings" |
| `bun.PathBuffer` (`[MAX_PATH_BYTES]u8`) | `bun_paths::PathBuffer` | `var buf: bun.PathBuffer = undefined;` → `let mut buf = bun_paths::PathBuffer::uninit();` |
| `bun.WPathBuffer` | `bun_paths::WPathBuffer` | `[u16; MAX_PATH]`, Windows |
| `std.mem.Allocator` | `&dyn bun_alloc::Allocator` | see "Allocators" |
| `u32`, `i64`, `usize`, `c_int` | `u32`, `i64`, `usize`, `c_int` | 1:1 |
| `bool` | `bool` | |
| `packed struct(uN)` | `bitflags!` if **every** field is `bool`; otherwise `#[repr(transparent)] pub struct Foo(uN)` with manual `const`/shift accessors matching field order | |
| `enum(uN)` | `#[repr(uN)] enum` | |
| `union(enum)` | `enum` with payload variants | Rust enums *are* tagged unions |
| `extern struct` | `#[repr(C)] struct` | |
| `pub const Foo = opaque {};` (FFI handle, used as `*Foo`) | `#[repr(C)] pub struct Foo { _p: [u8; 0], _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)> }` | Nomicon pattern; `!Send + !Sync + !Unpin` |
| `opaque {}` as type-tag (e.g. `GenericIndex(u32, opaque {})`) | drop entirely — declare a newtype: `pub struct FooId(u32);` | Zig needs `opaque {}` to mint distinct type params; Rust newtypes are already distinct |
| `x: anytype` | `x: impl Trait` if a single trait covers it (`impl AsRef<[u8]>`, `impl Display`); else a generic `<T>` bounded by the methods the body actually calls. If the body never calls a method on `x` (opaque context/userdata pattern), use an **unbounded** `<C>` — no trait; if stored across calls, `<C: 'static>` (and `Box::into_raw` when it round-trips through C as `*mut c_void`). For `args: anytype` in printf-style fns → `core::fmt::Arguments` via `format_args!`. | |
| `(comptime X: type, arg: X)` paired params | drop the type param; write `arg: &mut impl Trait` (or `<X: Trait>(arg: X)` if `X` is reused in another position). For writers: `&mut impl core::fmt::Write` (text) / `&mut impl bun_io::Write` (bytes). | Zig's verbose spelling of `arg: anytype` when the type needs naming |

## Idiom map

| Zig pattern | Rust pattern |
|---|---|
| `defer x.deinit()` | **delete the line** — `impl Drop for T` makes it implicit at scope exit. Reach for `ManuallyDrop<T>` **only** when (a) the value is arena-allocated and freed by `arena.reset()` not per-value, (b) destruction order must differ from declaration order and matters for correctness (rare — add `// PORT NOTE`), or (c) the type is the `m_ctx` payload of a `.classes.ts` class and `finalize()` owns teardown. Never expose `pub fn deinit(&mut self)` as the public API; if explicit early release is needed (sockets, fds), name it `close(self)` taking ownership. |
| `pub fn deinit(self: *T)` (definition) | `impl Drop for T`. If the body only frees/deinits owned fields, **delete the body entirely** — Rust drops `Box`/`Vec` fields automatically. Keep an explicit `Drop` body only for side effects beyond freeing (closing FDs, deref-ing intrusive refcounts, FFI destroy calls). If `deinit` takes an `allocator` param, retype the fields to own their allocator (`Box`/`Vec`, not raw slices) — `Drop` cannot take params. Types that are `#[repr(C)]` and constructed/destroyed across FFI keep an explicit `unsafe fn destroy(*mut Self)` instead; `.classes.ts` payloads use `finalize`, not `Drop` (see §JSC). |
| `allocator.free(this.field)` / `allocator.free(local)` | **delete** — retype the field/local as `Box<[T]>` / `Vec<T>` so `Drop` (or scope exit) frees it. Only keep an explicit `alloc.dealloc(ptr, layout)` when the allocation came from a non-default allocator that must be matched. Arena-allocated slices are never individually freed (the Zig won't have `allocator.free` for them anyway). |
| `defer pool.put(x)` after `pool.get()` | The Rust pool returns a guard: `let x = bun_paths::path_buffer_pool().get();` — guard `Deref`s to `&mut PathBuffer` and puts back on `Drop`. Do not hand-roll a `defer` here. |
| `errdefer x.deinit()` / `errdefer alloc.free(x)` (local you just constructed) | **delete it.** Once `x` is `Vec`/`Box`/any `Drop` type, `?` drops it automatically on the error path. No guard, no inline cleanup. |
| `errdefer { <side effects> }` (rolls back a counter, unregisters from a map, closes a remote handle — anything beyond freeing a local) | `let guard = scopeguard::guard(state, \|s\| <cleanup>);` and on the success path `let state = ScopeGuard::into_inner(guard);` to disarm. Never hand-roll a `Drop` struct + `mem::forget`. Leave `// TODO(port): errdefer` only when the cleanup captures ≥2 disjoint `&mut` borrows that scopeguard cannot express. |
| `comptime T: type` param | plain generic `<T>` (add a trait bound for whatever methods the body calls — usually one already exists). **Not** const generics — Rust const generics carry values, not types. |
| `comptime flag: bool` / `comptime n: uN` param | `<const FLAG: bool>` / `<const N: uN>` const generic. If the param is only forwarded and never used in a type/const position, demote to a runtime arg and leave `// PERF(port): was comptime monomorphization — profile in Phase B`. **Do not** demote when the bool gates a hot inner-loop branch (e.g. `enable_ansi_colors` in printers, `ssl` in `NewHTTPContext`). |
| `comptime e: SomeEnum` param | `<const E: SomeEnum>` with `#[derive(core::marker::ConstParamTy, PartialEq, Eq)]` on the enum. |
| `comptime` on an expression | `const fn` / `const { }`. Reach for `macro_rules!` only when the Zig is doing token-pasting or type-list iteration with no shared trait. |
| `fn Foo(comptime T: type[, comptime opts...]) type { return struct {...} }` | `pub struct Foo<T[, const OPTS...]> { ... }` with `impl<T> Foo<T> { ... }`. The Zig fn name becomes the struct name; nested `pub const`/`pub fn` become associated items. Only use a `macro_rules!` type-generator when the body branches on `@typeInfo` to emit structurally different layouts (rare). |
| `switch (u) { inline else => \|v[, tag]\| v.expr() }` | `match u { A(v) => v.expr(), B(v) => v.expr(), ... }` written out (or generated by a small derive if >8 variants). If the payload types share the called method, that method belongs on a trait they all impl. |
| `switch (b) { inline else => \|c\| callee(c, ...) }` (runtime bool → comptime) | if the callee still needs `<const B: bool>`: `if b { callee::<true>(...) } else { callee::<false>(...) }`. If the comptime bool was only forwarded (never used in a type position), drop the const param, pass `b` at runtime, and leave `// PERF(port): was comptime bool dispatch — profile in Phase B`. |
| struct field default `field: T = .{}` / `= ""` / `= 0` | `#[derive(Default)]` if every default is the field type's `Default`; otherwise `impl Default for T { fn default() -> Self { ... } }`. Callsites `.{}` → `T::default()`. For `= ""` on owned slice fields, the `Default` is `Box::default()` (empty slice). |
| `comptime` string formatting (`std.fmt.comptimePrint`) | `concat!(...)` for literal concatenation, or `const_format::formatcp!(...)` which yields `&'static str`. **Never** `format!` — that heap-allocates at runtime where Zig paid zero. |
| `const x = brk: { ...; break :brk v; }` | Rust labeled block (stable since 1.65): `let x = 'brk: { ...; break 'brk v; };`. Works for early breaks too — no `loop` hack, no helper fn. Only hoist to a helper if the block is >40 lines AND has ≥3 break points (and leave `// TODO(port): hoisted from labeled block`). If there are no early breaks, a plain `let x = { ...; v };` suffices. |
| `const Foo = @This();` (file-level) | drop — name the `pub struct Foo { … }` directly. |
| `@This()` inside a generic fn body | `Self` (the impl's inherent `Self`). |
| `@as(T, x)` | drop it — Rust infers the result type. If used to set the result type of a nested cast (`@as(u32, @intCast(x))`), write the target type on the cast itself (`u32::try_from(x).unwrap()` / `x as u32`). For type ascription on a binding, use `let v: T = x;`. |
| `@fieldParentPtr("field", ptr)` | `unsafe { &mut *(ptr as *mut _ as *mut u8).sub(core::mem::offset_of!(Parent, field)).cast::<Parent>() }` with `// SAFETY: ptr points to Parent.field`. (`offset_of!` stable since 1.77.) |
| `@ptrCast` / `@alignCast` | `ptr.cast::<T>()` / `&*(p as *const T)` in `unsafe` |
| `@intFromEnum(e)` | `e as uN` |
| `@enumFromInt(n)` | `unsafe { core::mem::transmute::<uN, E>(n) }` (with `#[repr(uN)]`) or a `const fn E::from_raw(n: uN) -> E` that debug-asserts range. **Never** `FromPrimitive` in hot paths — it generates a runtime `match` over every variant. |
| `@intCast(x)` | `T::try_from(x).unwrap()` (narrowing — always checked; Phase B may swap to `as` in proven-hot loops with `// PERF(port): @intCast`) or `x.into()` / `T::from(x)` (widening — infallible). **Never** bare `as` for narrowing; reserve bare `as` for `@truncate`. |
| `@truncate(x)` | `x as T` (intentional wrap) |
| `@intFromBool(b)` | `b as uN` (or `usize::from(b)`). Compiles to the same single instruction; no branch. |
| `@floatFromInt(x)` | `x as f64` (lossless for ≤52-bit ints; otherwise Zig also rounds). |
| `@intFromFloat(x)` | `x as uN` — **note**: Rust saturates on overflow/NaN where Zig is UB. If the Zig relied on prior range checks, keep them; do not add new ones. |
| `@bitCast(x)` | `unsafe { core::mem::transmute(x) }` for same-size POD; prefer safe forms when they exist: `f64::to_bits`/`from_bits`, `u32::from_ne_bytes`, packed-struct `.bits()`. |
| `@intFromPtr(p)` | `p as usize` (or `p.addr()` strict-provenance) |
| `@ptrFromInt(n)` | `n as *mut T` in `unsafe`; if round-tripping a real pointer, prefer `ptr.byte_add(off)` to keep provenance. |
| `@memcpy(dst, src)` | `dst.copy_from_slice(src)` (panics on len mismatch, same as Zig; **non-overlapping only**) |
| `bun.copy(T, dst, src)` | `dst[..src.len()].copy_from_slice(src)` (matches Zig: `dst.len() >= src.len()` allowed). If `src` and `dst` may overlap (same buffer): `dst.copy_within(range, dest_idx)` or `unsafe { core::ptr::copy(src.as_ptr(), dst.as_mut_ptr(), src.len()) }`. |
| `@memset(dst, v)` | `dst.fill(v)`; for zeroing raw bytes: `unsafe { ptr::write_bytes(p, 0, n) }` |
| `@min(a, b)` / `@max(a, b)` | `a.min(b)` / `a.max(b)` (method form, avoids `Ord` import). For >2 args use `[a, b, c].into_iter().min().unwrap()`. If Zig was relying on peer-type widening, cast the narrower operand first. |
| `@tagName(e)` | `<&'static str>::from(e)` (or `e.into()`) — `#[derive(strum::IntoStaticStr)]` on the enum. For `union(enum)` ported to a Rust enum, same derive. |
| `@errorName(e)` | `<&'static str>::from(e)` — `#[derive(strum::IntoStaticStr)]` on the error enum. For `bun_core::Error` the crate provides `.name() -> &'static str`. **Never** use `Display`/`to_string()` here — that is the human message, not the tag, and diverges from Zig output (snapshot tests, JS `error.code`, crash-handler trace encoding all depend on the exact string). Never `format!("{e:?}")`. |
| `a -\| b` / `a +\| b` / `a *\| b` | `a.saturating_sub(b)` / `a.saturating_add(b)` / `a.saturating_mul(b)` |
| `a +% b` / `a -% b` / `a *% b` | `a.wrapping_add(b)` / `a.wrapping_sub(b)` / `a.wrapping_mul(b)` — do **not** use bare `+`; Rust panics in debug. |
| `std.math.maxInt(T)` / `std.math.minInt(T)` | `T::MAX` / `T::MIN` |
| `std.mem.zeroes(T)` | `unsafe { core::mem::zeroed::<T>() }` **only** if `T` is `#[repr(C)]` POD with no `NonNull`/`NonZero`/enum fields. Otherwise implement `T::ZEROED` / `Default` by hand. Add `// SAFETY: all-zero is a valid T`. |
| `std.mem.span(p)` on `[*:0]const u8` | `unsafe { CStr::from_ptr(p) }.to_bytes()` or `bun_str::ZStr::from_ptr(p)`. |
| `std.mem.sliceTo(buf, 0)` | `&buf[..buf.iter().position(\|&b\| b == 0).unwrap()]` (or `bun_str::slice_to_nul(buf)`). |
| `inline for` over a tuple | if all elements are the same type, use a `const [T; N]` + plain `for`. Only reach for `macro_rules!`/unrolling when elements are heterogeneous types. |
| `for (slice, 0..) \|x, i\|` | `for (i, x) in slice.iter().enumerate()` |
| `for (a, b) \|x, y\|` | `for (x, y) in a.iter().zip(b)` — Zig asserts `a.len == b.len`; add `debug_assert_eq!(a.len(), b.len())` because `zip` silently truncates. |
| `for (a, b) \|x, *y\|` | `for (x, y) in a.iter().zip(b.iter_mut())` |
| `switch` on tagged union | `match` |
| `catch \|e\| { ... }` | `.map_err(\|e\| ...)?` or explicit `match` |
| `x catch \|e\| switch (e) { error.A => fa, error.B => fb, else => fe }` | `match x { Ok(v) => v, Err(FooError::A) => fa, Err(FooError::B) => fb, Err(_) => fe }` when the error type is a local enum. When the error is `bun_core::Error`, match against interned consts: `Err(e) if e == bun_core::err!(ENOENT) => …`. Never compare `e.name()` to a string literal. |
| `x catch return <expr>` (no capture) | `let Ok(v) = x else { return <expr>; }` — or `.ok()?` when the enclosing fn returns `Option` and `<expr>` is `null`. |
| `x catch <expr>` (no capture) | `x.unwrap_or(<expr>)` / `x.unwrap_or_else(\|_\| <expr>)` |
| `x catch unreachable` | `x.expect("unreachable")` (or `.unwrap_or_oom()` if it's an alloc). Do **not** turn into `?`, and do **not** use `unwrap_unchecked()` — keep the safety check until Phase B proves the invariant. |
| `try x` | `x?` |
| `orelse` | `.unwrap_or(..)` / `.ok_or(..)?` / `let Some(x) = .. else { .. }` |
| `if (x) \|y\|` | `if let Some(y) = x` |
| `while (it.next()) \|x\|` | `while let Some(x) = it.next()` or `for x in it` |
| `std.mem.tokenizeScalar(u8, s, c)` | `s.split(\|b\| *b == c).filter(\|s\| !s.is_empty())` — Rust std slice ops are fine; only `std::fs/net/process` are banned |
| `std.mem.trimRight(u8, s, chars)` | `bun_str::strings::trim_right(s: &[u8], chars: &[u8]) -> &[u8]`. For `sep_str`, pass `&[bun_paths::SEP]` (or `SEP_STR.as_bytes()`). |
| `bun.strings.w("...")` (comptime UTF-16 literal) | `bun_str::w!("...")` macro → `&'static [u16]` (`.len()` excludes the trailing NUL, matching Zig `[:0]const u16` — backing storage has NUL at `[len]`). |
| `bun.strings.fooComptime(x, "lit")` | `bun_str::strings::foo(x, b"lit")` — drop the `Comptime` suffix; Rust `&'static [u8]` literal is already const-propagated. |
| `bun.assert(x)` | `debug_assert!(x)` |
| `comptime bun.assert(x)` | `const _: () = assert!(x);` at item scope. Inside an `inline for` body, hoist to a per-element `const` or drop it (Phase B). |
| `bun.unreachablePanic(...)` / `unreachable` | `unreachable!()` |
| `@branchHint(.cold)` | `#[cold]` on the fn, or `if cold_path() { #[cold] fn cold() {..} cold() }` |
| `bun.Output.scoped(.X, .vis)("fmt", .{a,b})` | `bun_output::scoped_log!(X, "fmt {} {}", a, b);` — visibility is encoded by registering the scope once with `bun_output::declare_scope!(X, hidden);` at module level. Zig `{s}` on `[]const u8` → wrap arg in `bstr::BStr::new(x)` (Display impl over bytes); do not `from_utf8` — bytes may not be valid UTF-8. `scoped_log!` MUST expand to `if cfg!(feature="debug_logs") && SCOPE.enabled() { ... }` so arg expressions are inside the dead branch. Do not pre-build `format_args!` outside the gate — that forces evaluation of every interpolated expr in release. |
| `threadlocal var X: T = init;` | `thread_local! { static X: Cell<T> = const { Cell::new(init) }; }` — the `const { }` initializer (stable 1.59+) elides the lazy-init branch. Access via `X.with(\|x\| ...)`. For large buffers (`threadlocal var buf: PathBuffer`): `thread_local! { static BUF: RefCell<PathBuffer> = const { RefCell::new(PathBuffer::ZEROED) }; }` and `BUF.with_borrow_mut(\|b\| ...)`. |
| `pub fn format(self, writer: *std.Io.Writer) !void` (std.fmt protocol) | `impl core::fmt::Display for T { fn fmt(&self, f: &mut Formatter) -> fmt::Result { ... } }`. If the Zig wraps another value (`struct { x: *X } + format()`), make it a tuple newtype `pub struct XFmt<'a>(&'a X);` with `Display`. |
| `pub const X = @import("../foo_jsc/..").y;` (the `*_jsc` alias) | **delete it.** In Rust, `to_js`/`from_js` are extension-trait methods that live in the `*_jsc` crate. The base type has no mention of jsc. |

## Comptime reflection

`@TypeOf(param)` where `param: anytype` → **drop it**; name the generic `<T>`
and use `T` directly. Zig needs `@TypeOf` because `anytype` is unnamed; in Rust
the generic param IS the name. `@TypeOf` only needs special handling when fed
into `@typeInfo` (true reflection) — see below.

`@typeInfo(T)` / `@field(x, "name")` have **no Rust equivalent**. Strategy:

- If used to iterate struct fields to implement equality/hash/clone/drop →
  `#[derive(PartialEq, Eq, Hash, Clone)]` (and `Drop` by hand). If iterating
  fields to implement a domain protocol (`toCss`, `parse`, `toJS`) → make the
  protocol a trait and impl it per type (a targeted `#[derive(ToCss)]` is fine,
  but the trait comes first). Only reach for a generic `Fields` reflection
  derive when the body truly needs field NAMES at runtime.
- `if (@hasDecl(T, "foo")) T.foo(x) else @compileError(...)` → drop the `if`;
  add trait bound `T: Foo` and call `x.foo()`. `@hasDecl` is Zig's structural
  duck-typing check — a trait bound IS that check.
  `if (@hasDecl(T, "foo")) T.foo(x) else default_expr` (optional behavior) →
  trait with a default method, or a blanket impl that the type can override.
  Never a runtime check.
- If used to inspect a fn signature (the `host_fn` pattern) → proc-macro
  attribute; leave `// TODO(port): proc-macro`.
- `@field(x, comptime name)` for intrusive lists → keep raw-ptr offset via
  `core::mem::offset_of!(T, field)` (stable since 1.77).

## Strings

**Data is bytes, not `str`.** Do **not** use `std::string::String` / `&str` /
`.to_string()` / `String::from_utf8*` for file paths, source code, HTTP
bytes, module specifiers, env vars, or anything that came from a syscall or
the network. These are `&[u8]` / `Vec<u8>` / `Box<[u8]>`. Bun handles WTF-8
and arbitrary bytes; inserting UTF-8 validation is both a perf tax and a
correctness bug (rejects valid Linux paths, lone surrogates, etc.).

Only use `&str`/`String` for: (a) string literals you wrote, (b) the final
hop into a Rust API that genuinely requires `&str` (rare — and use
`bstr::BStr::new(bytes)` for `Display`/`Debug` instead of `from_utf8_lossy`).
Never `.unwrap()` a `from_utf8` on external data.

| Zig | Rust | |
|---|---|---|
| `[]const u8` (text-ish) | `&[u8]` — **not** `&str` | |
| owned text buffer that grows | `Vec<u8>` — **not** `String` | |
| `std.mem.eql(u8, a, b)` | `a == b` | slice `Eq` |
| `bun.strings.eqlComptime(a, "lit")` | `a == b"lit"` | byte literal |
| `bun.strings.hasPrefix` / `hasSuffix` | `a.starts_with(p)` / `.ends_with(p)` | |
| `bun.strings.indexOfChar(a, c)` / `indexOfScalar` | `bun_str::strings::index_of_char(a, c)` | FFI → `highway_index_of_char` SIMD. **Not** `memchr`/`bstr`. |
| `bun.strings.indexOf(a, n)` | `bun_str::strings::index_of(a, n)` | highway SIMD substring |
| `bun.strings.indexOfAny(a, set)` / `indexOfAnyT` | `bun_str::strings::index_of_any(a, set)` | FFI → `highway_index_of_any_char` |
| `bun.strings.containsChar` / `contains` | `bun_str::strings::index_of_char(..).is_some()` | |
| `bun.highway.*` | `bun_highway::*` | direct `extern "C"` re-exports; same C++ |
| any other `bun.strings.<fn>` not listed | `bun_str::strings::<fn>` | port `src/string/immutable.zig` 1:1; do NOT substitute `bstr`/`memchr` for hot-path scanners |
| cold-path byte ops with no `bun.strings` equivalent (`.split()`, `.trim_ascii()`, ad-hoc `.find()`) | `bstr::ByteSlice` ext trait | OK here only |
| `std.fmt.allocPrint(a, "..", .{})` | build into `Vec<u8>` with `use std::io::Write; write!(&mut v, ..)` | drop allocator; never `format!` (returns `String`) |
| `std.fmt.bufPrint(buf, ..)` | `write!(&mut &mut buf[..], ..)` | `std::io::Write` on `&mut [u8]` |

**Shared/ref-counted strings stay shared.** `bun.String` is the
WTFString-backed shared buffer (crosses to JSC without copy). Keep it as
`bun_str::String` — do not "simplify" to `Arc<str>` or `String`; you lose
zero-copy JS interop and Latin-1/UTF-16 storage.

`bun.String` is a 5-variant tagged union over WTF-backed and Zig-slice-backed
strings. In Rust:

```rust
// bun_str::String — #[repr(C)] struct { tag: u8, value: StringValue }
// NOT a Rust enum (C++ mutates tag and value independently across FFI).
```

- `s.toUTF8(alloc)` → `s.to_utf8()` returning `bun_str::Utf8Slice<'_>` (borrows
  if already UTF-8, else owns the transcoded buffer; Drop frees). No allocator
  param. This is **encoding** (WTF-16→UTF-8), not validation — output is bytes.
- `s.toJS(global)` → `s.to_js(global)` — **only callable in `*_jsc`/`runtime`/`jsc` crates** via the `StringJsc` extension trait. If your file is in a base crate and calls `.toJS`, leave `// TODO(port): move to *_jsc`.
- `bun.String.borrowUTF8(slice)` → `bun_str::String::borrow_utf8(slice)` (caller keeps slice alive — `'a` lifetime on the borrow).
- `ZigString` → `bun_str::ZigString` (legacy; prefer `bun_str::String`).

`[:0]const u8` → `&ZStr`:
```rust
pub struct ZStr<'a> { ptr: *const u8, len: usize, _p: PhantomData<&'a [u8]> }
// .as_bytes() / .as_ptr() / .as_cstr() — len does NOT include the NUL.
```

Construct from a buffer you just NUL-terminated:
`unsafe { ZStr::from_raw(buf.as_ptr(), len) } // SAFETY: buf[len] == 0 written above`.
For `[:0]u16` use `WStr::from_raw` (`&WStr`) or `WStr::from_raw_mut(buf.as_mut_ptr(), len)`
(`&mut WStr`). Same for `ZStr::from_raw_mut`.

## Allocators

**AST/parser crates keep arenas. Everything else uses the global allocator.**

AST crates = `js_parser`, `js_printer`, `css`, `bundler`, `bake`, `sourcemap`,
`shell` (parser), `interchange`, `install/lockfile`. These build large trees of
small nodes bulk-freed at end-of-parse; arena allocation is load-bearing for
throughput.

**In AST crates:**
- `MimallocArena` / `std.heap.ArenaAllocator` → `bumpalo::Bump` (re-exported as
  `bun_alloc::Arena`).
- `std.mem.Allocator` param (when callers in this file pass an arena) →
  `bump: &'bump Bump`. Thread it. The struct/fn gets a `<'bump>` lifetime.
  When callers pass `bun.default_allocator` → delete the param (global mimalloc).
- `std.ArrayList(T)` / `ArrayListUnmanaged(T)` fed an arena →
  `bumpalo::collections::Vec<'bump, T>`. `.append(a, x)` → `v.push(x)` (arena
  bound at construction, not per-call).
- `allocator.create(T)` (arena) → `bump.alloc(init)` returns `&'bump mut T`.
  `allocator.dupe(u8, s)` → `bump.alloc_slice_copy(s)` returns `&'bump [u8]`.
- `arena.reset()` → `bump.reset()`. Everything `'bump` is invalidated; borrow
  checker enforces this.
- `Expr.Data.Store` / `Stmt.Data.Store` / `ASTMemoryAllocator` are typed slabs
  with stable addresses (nodes reference each other) → `typed_arena::Arena<T>`.
  Returns `&'arena T`, never moves. Cross-node refs are `&'arena Expr`. Do not
  convert to `Vec<Expr>`.

**In all other crates:**
- `std.mem.Allocator` param → **delete it.** `Box`/`Vec`/`String` use global
  mimalloc.
- `MimallocArena` / `ArenaAllocator` local → delete the arena and its
  `.reset()`/`.deinit()`. Only leave `// PERF(port): was arena bulk-free` if
  the body allocates per-iteration in a hot loop.
- `allocator.dupe(u8, s)` → `Box::<[u8]>::from(s)` (or `s.to_vec()` if it
  grows). `allocator.dupeZ` → `bun_str::ZStr::from_bytes(s)`.
- `allocator.create(T)` / `allocator.destroy(p)` → `Box::new` / `drop`.
- `allocator.alloc(T, n)` → `vec![T::default(); n].into_boxed_slice()` or
  `Box::new_uninit_slice(n)` if uninitialized.
- `StackFallbackAllocator` → just use the heap; `// PERF(port): was
  stack-fallback`.

**Everywhere:**
- `bun.default_allocator` → delete the expression.
- `bun.new(T, init)` / `bun.destroy(p)` → `Box::new(init)` / `drop(b)`. If the
  pointer crosses FFI as `*mut T`, use `Box::into_raw` / `Box::from_raw`.
- `bun.handleOom(expr)` → `expr` (Rust `Vec`/`Box` allocation aborts on OOM;
  `handleOom` was Zig's panic-on-OOM wrapper, which is now the default).

## Pointers & ownership

| Zig | Rust |
|---|---|
| `bun.ptr.Owned(T)` | `Box<T>` |
| `bun.ptr.Shared(*T)` | `Rc<T>` (always single-thread; non-intrusive). Do **not** introduce a custom `bun_ptr::Shared<T>` to save the weak-count word — 4 uses tree-wide, 8 bytes per allocation is negligible, and you lose `Rc::downgrade`/`make_mut`/`get_mut`. Leave `// PERF(port): Rc weak-count header — profile in Phase B` if you suspect a hot array. |
| `bun.ptr.AtomicShared(*T)` | `Arc<T>` (always atomic) |
| `bun.ptr.RefCount(...)` (intrusive, single-thread, deprecated) | `bun_ptr::IntrusiveRc<T>` — `#[repr(transparent)] NonNull<T>` where `T` has `ref_count: Cell<u32>` at the same field offset. **Never** `Rc<T>` when `*T` crosses FFI or is recovered via `container_of!`. |
| `bun.ptr.ThreadSafeRefCount(...)` (intrusive, atomic, deprecated) | `bun_ptr::IntrusiveArc<T>` (same as above, `AtomicU32` count). Only fall back to `Arc<T>` if `*T` never crosses FFI. |
| `bun.ptr.Cow(T)` | `Cow<'_, T>` or `Arc<T>` + `Arc::make_mut` |
| `bun.ptr.WeakPtr(T, field)` (intrusive, deprecated) | keep as `*mut T` + manual ref/deref over an embedded `WeakPtrData`, or migrate the owner to `Rc<T>` and use `std::rc::Weak`. Do NOT blindly map to `std::rc::Weak` / `std::sync::Weak` when the owner is intrusive — those assume an `Rc`/`Arc` allocation header. |
| `bun.ptr.TaggedPointer` | `bun_collections::TaggedPtr` (`#[repr(transparent)] u64`, addr:49 + tag:15) |
| `bun.ptr.TaggedPointerUnion(Types...)` | `bun_collections::TaggedPtrUnion<(T1, T2, ...)>` — always. The packed u64 layout is load-bearing (stored in arrays, hashed). Do NOT expand to a Rust enum; that's 16 bytes vs 8. |
| `bun.HiveArray(T, N)` | `bun_collections::HiveArray<T, N>` |
| `*T` field with separate `deinit()` | `Box<T>` if unique owner; `*mut T` + `// SAFETY:` if shared |

**Intrusive lists / `@fieldParentPtr` patterns:** keep them. Use raw pointers
and `core::mem::offset_of!` (see `@fieldParentPtr` row in §Idiom map). Don't
try to make them `Pin<Box<T>>` in Phase A.

## Collections

| Zig | Rust |
|---|---|
| `std.ArrayList(T)` / `std.ArrayListUnmanaged(T)` | **Non-AST crates:** `Vec<T>`, drop every allocator arg. **AST crates** (see §Allocators): `bumpalo::collections::Vec<'bump, T>` if Zig fed it an arena, else `Vec<T>`. Method map (both): `.append(x)`→`.push(x)` · `.appendSlice(s)`→`.extend_from_slice(s)` · `.appendAssumeCapacity(x)`→`.push(x)` + `// PERF(port): was assume_capacity` · `.ensureTotalCapacity(n)`→`.reserve(n.saturating_sub(v.len()))` · `.ensureTotalCapacityPrecise(n)`→`.reserve_exact(..)` · `.toOwnedSlice()`→`.into_boxed_slice()` (or `.into_bump_slice()`) · `.items`→`.as_slice()`/`&v` · `.clearRetainingCapacity()`→`.clear()` · `.swapRemove(i)`→`.swap_remove(i)`. Managed/unmanaged split disappears. |
| `std.AutoHashMap(K,V)` | `bun_collections::HashMap<K,V>` (wyhash, not SipHash) |
| `std.StringHashMap(V)` | `bun_collections::StringHashMap<V>` |
| `std.AutoArrayHashMap(K,V)` / `std.StringArrayHashMap(V)` | `bun_collections::ArrayHashMap<K,V>` — wyhash, insertion-order iteration, `.values()` returns contiguous slice. Do NOT substitute `HashMap` or `indexmap`. |
| `bun.MultiArrayList(T)` | `bun_collections::MultiArrayList<T>` (SoA) |
| `bun.BabyList(T)` | `bun_collections::BabyList<T>` (`ptr+len+cap`, `#[repr(C)]`) |
| `std.BoundedArray(T,N)` | `bun_collections::BoundedArray<T, N>` |
| `std.EnumArray(E, V)` | `enum_map::EnumMap<E, V>` with `#[derive(enum_map::Enum)]` on `E`. Dense `[V; N]` indexed by variant; the derive's associated `Array<V>` type hides the count (stable Rust cannot write `[V; <E as Enum>::COUNT]` generically). Do NOT use `HashMap`. |
| `std.EnumSet(E)` | `enumset::EnumSet<E>` with `#[derive(enumset::EnumSetType)]` on `E`; storage is the smallest `uN` fitting the variant count. Do NOT use `bitflags!` — it requires hand-assigning power-of-two values and defines a new type; it cannot wrap an existing `#[repr(uN)] enum`. |
| `std.EnumMap(E, V)` (sparse, not all keys set) | `enum_map::EnumMap<E, Option<V>>` — or, if the discriminant overhead matters, `{ present: enumset::EnumSet<E>, values: [MaybeUninit<V>; N] }` by hand with `// PERF(port)`. |
| `bun.StringMap` | `bun_collections::StringMap` |
| `bun.ComptimeStringMap(V, .{...})` | `static MAP: phf::Map<&'static [u8], V> = phf::phf_map! { b"key" => val, ... };` | compile-time perfect hash. For ≤8 entries a plain `match` on `&[u8]` is fine. `.getWithEql`/case-insensitive → `// TODO(port): phf custom hasher` |
| `bun.ComptimeEnumMap(E)` | `phf::Map<&'static [u8], E>` built from `E`'s `@tagName`s | or `strum::EnumString` if keys are exactly variant names |
| `bun.bit_set.IntegerBitSet(N)` | `bun_collections::IntegerBitSet<N>` (`#[repr(transparent)] uN`) — inline, no heap |
| `bun.bit_set.StaticBitSet(N)` / `ArrayBitSet(usize, N)` | `bun_collections::StaticBitSet<N>` (`[usize; (N+63)/64]`) — inline, no heap |
| `bun.bit_set.DynamicBitSet` / `DynamicBitSetUnmanaged` | `bun_collections::DynamicBitSet` (heap-backed `Box<[usize]>`) |
| `bun.bit_set.AutoBitSet` | `bun_collections::AutoBitSet` (Bun-specific runtime static-or-dynamic; no std/crate equivalent) |

Do **not** use `std::collections::HashMap` (SipHash, different iteration order
→ behavioral diffs).

## JSC types

```rust
// bun_jsc::JSValue
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct JSValue(i64, PhantomData<*const ()>);  // PhantomData<*const ()> = !Send + !Sync
// (negative impls `impl !Send` are nightly-only: feature(negative_impls), tracking #68318)
// No lifetime. Kept alive by conservative stack scan — stack/registers ONLY.
```

- **Never store a bare `JSValue` as a field on a heap-allocated Rust struct.**
  Conservative scan covers stack/registers only. For struct fields use
  `bun_jsc::Strong` (root), `bun_jsc::JsRef` (self-wrapper ref), or a codegen'd
  `own:` property (C++-side `WriteBarrier`). A `JSValue` field in a
  `Box`/`Arc`/`Vec` payload is a use-after-free.
- `globalObject: *JSGlobalObject` → `global: &JSGlobalObject` (always borrowed).
- `callframe: *CallFrame` → `frame: &CallFrame`.
- `.js_undefined` → `JSValue::UNDEFINED`. `.jsNull()` / `.null` → `::NULL`.
  `.jsBoolean(b)` → `JSValue::from(b)`. `.true`/`.false` → `::TRUE`/`::FALSE`.
- `.zero` → `JSValue::ZERO` (encoded `0`). Distinct from `UNDEFINED`. It means
  "no value / exception pending" and is what a host fn must return after
  throwing. `value == .zero` checks become `value.is_empty()`.
- `value.ensureStillAlive()` → `value.ensure_still_alive()`:
  `if value.is_cell() { core::hint::black_box(value.0); }`. This matches Zig's
  `doNotOptimizeAway` (no-op for non-cells; `black_box` stable since 1.66).
  Call it **after** the last use of any interior pointer derived from `value`
  (typed-array `.as_slice()`, string `.characters8()`), not before. It is
  point-in-time, not RAII — for scope-long protection use
  `let _keep = EnsureStillAlive(value);` whose `Drop` calls `black_box`. If
  release-only GC crashes persist, upgrade to inline asm matching JSC:
  `unsafe { core::arch::asm!("", in(reg) value.0, options(nostack, preserves_flags)); }`
  — `black_box` is best-effort per std docs and lacks the `"memory"` clobber
  JSC uses.
- Building a slice of `JSValue`s to pass as call arguments? **Do not** use
  `Vec<JSValue>` — its backing storage is on the Rust heap, not stack-scanned.
  Use `bun_jsc::MarkedArgumentBuffer` (registered with the VM as a root) or a
  fixed-size on-stack `[JSValue; N]`. If any element is created via
  `to_js()`/`get_index()` while looping, earlier elements can be collected
  mid-loop.
- `JSRef` field → `bun_jsc::JsRef` (non-generic; tagged union
  `Weak(JSValue) | Strong(Strong.Optional) | Finalized`). Its `.weak` arm is a
  *bare JSValue*, not a `JSC::Weak` — only sound because the codegen'd
  `finalize()` flips it to `.finalized`. Do **not** use `JsRef` on a struct
  without `finalize: true`.
- `Strong` / `Strong.Optional` → `bun_jsc::Strong` (a `HandleSlot` allocated
  from `vm.heap.handleSet()` — same root set `JSC::Strong<T>` uses; GC root;
  `Drop` deallocates the slot). **If the Rust struct is itself owned by the JS
  wrapper (`m_ctx`), a `Strong` pointing back at the wrapper or anything that
  can reach it is a permanent leak — use `JsRef` instead.**
- `bun_jsc::Strong` and `bun_jsc::JsRef` are `!Send + !Sync` (enforce via
  `PhantomData<*const ()>`). The `HandleSlot` is owned by the VM's `HandleSet`;
  `Drop` must run on the JS thread. Moving one into an `Arc<T>` and dropping
  from a thread-pool thread is UB.
- `globalThis.vm().reportExtraMemory(n)` →
  `global.vm().deprecated_report_extra_memory(n)` (no cell — matches the Zig
  binding exactly). This is the *incremental-growth* path (buffer appended,
  slice cloned). The non-deprecated `heap.reportExtraMemoryAllocated(cell, n)`
  is called **by the codegen** at construction when `.classes.ts` has
  `estimatedSize: true` — do not hand-port that. If the Zig type implements
  `pub fn estimatedSize(...) usize`, keep it — codegen wires **both**
  `reportExtraMemoryAllocated` (in `construct`/`__create`) and
  `reportExtraMemoryVisited` (in `visitChildren`). You only call
  `deprecated_report_extra_memory(delta)` manually for **subsequent growth**
  after construction. **Both halves are required**: alloc-side without
  visit-side → back-to-back full GCs; visit-side without alloc-side → OOM.
- Host fn signature `fn(*JSGlobalObject, *CallFrame) bun.JSError!JSValue`
  (aka `JSHostFnZig`) →
  ```rust
  #[bun_jsc::host_fn]
  pub fn name(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>
  ```
  The `callconv(jsc.conv)` raw form (`JSHostFn`) is what the attribute macro
  emits — don't hand-write it.
- Method/getter host fns on `.classes.ts` types take `&mut Self` first:
  ```rust
  #[bun_jsc::host_fn(method)]
  pub fn name(this: &mut Self, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue>
  #[bun_jsc::host_fn(getter)]
  pub fn get_foo(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue>
  #[bun_jsc::host_fn(setter)]
  pub fn set_foo(this: &mut Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool>
  ```
  The macro emits the `callconv(jsc.conv)` shim that downcasts `m_ctx` →
  `*mut Self`.
- `bun.JSError!T` → `bun_jsc::JsResult<T>` (alias for `Result<T, JsError>`
  where `enum JsError { Thrown, OutOfMemory, Terminated }` — exception cell
  lives on the VM; the variant only records *which* error path).
- **`.classes.ts`-backed types**: the C++ JSCell wrapper stays generated C++.
  Your Rust struct is the `m_ctx` payload. Derive `#[bun_jsc::JsClass]` and
  the codegen wires `toJS`/`fromJS`/`hasPendingActivity`. Don't hand-write
  `visitChildren` — `WriteBarrier` fields live on the C++ side.
  `hasPendingActivity()` runs **on the GC thread, concurrently with the
  mutator**. It must use the JSC calling convention
  (`#[bun_jsc::host_call] extern fn(*mut Self) -> bool` — same ABI rewrite as
  `host_fn`: `"sysv64"` on Windows-x64, `"C"` elsewhere), read only `Atomic*`
  fields (`Ordering::Acquire`), and never allocate, take locks, or touch JS.
  Prefer `JsRef` upgrade/downgrade over `hasPendingActivity` when there is a
  single busy/idle edge.
- `.classes.ts` `finalize: true` → implement `pub fn finalize(this: *mut Self)`
  on the Rust struct. Runs on the mutator thread during lazy sweep — **do not
  touch any `JSValue`/`Strong` content** (other cells may already be swept).
  Call `self.this_value.finalize()` first, then drop native resources. Do NOT
  rely on it for prompt cleanup; expose explicit `close()`.

## FFI

```rust
// Zig: extern fn us_socket_write(s: *Socket, data: [*]const u8, len: c_int) c_int;
unsafe extern "C" {
    // items default to `unsafe fn`; write `safe fn` for fns the caller may treat as safe (1.82+)
    pub fn us_socket_write(s: *mut Socket, data: *const u8, len: c_int) -> c_int;
}
```

- All `extern fn` blocks → into the area's `*_sys` crate. If your file has
  externs and isn't already `*_sys`, leave them in place with
  `// TODO(port): move to <area>_sys`.
- `callconv(.c)` → `extern "C"`. JSC host fns: write `#[bun_jsc::host_fn]`
  exactly as shown in §JSC types (no `extern` on the user-facing fn — the
  attribute macro emits the correct ABI: `"sysv64"` on Windows-x64, `"C"`
  elsewhere). You cannot write `extern jsc_conv!()`; Rust does not accept a
  macro in ABI position.
- Exported fns (`@export`, `comptime { @export(...) }`) →
  `#[unsafe(no_mangle)] pub extern "C" fn name(...)`. (On edition 2021 plain
  `#[no_mangle]` still works, but match the `unsafe extern` style above.)

## Platform conditionals

```zig
if (Environment.isWindows) { ... } else { ... }
```
→
```rust
#[cfg(windows)] { ... }
#[cfg(not(windows))] { ... }
// or: if cfg!(windows) { ... } for trivial value-level selection
```

> **Caution:** `if cfg!(windows)` keeps both branches in the type-checker (and
> monomorphization) — it does NOT remove the dead branch like Zig's
> `if (Environment.isWindows)` does. Use the `#[cfg(...)]` form when the
> disabled branch references platform-only items.

`Environment.isDebug` → `cfg!(debug_assertions)`.
`Environment.isPosix` → `#[cfg(unix)]`.
`Environment.os == .windows/.mac/.linux/.wasm` →
`#[cfg(target_os = "windows"/"macos"/"linux")]` (or `#[cfg(windows)]` for the
windows arm). Treat exactly like `isWindows`.

## Don't translate

- `@import` lines at the bottom of the file → just `use bun_<area>::...;` at
  the top. Don't 1:1 the import block.
- `pub const X = @import("../foo_jsc/..").y;` alias lines → **delete.** See
  "Idiom map".
- `comptime { _ = @import(...); }` force-reference blocks → drop. Rust links
  what's `pub`.
- Generated files (`*_generated.zig`, `grapheme_tables.zig`,
  `boringssl_sys/boringssl.zig`, `libuv_sys/libuv.zig`, `schema.zig`) →
  write a 3-line `.rs` stub: `// GENERATED: re-run <generator> with .rs output`.
- Test blocks (`test "..." { ... }`) → `#[cfg(test)] mod tests { #[test] fn ...() { ... } }`.

## Output format

End your `.rs` with a trailer comment:

```rust
// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/<area>/<file>.zig (NNN lines)
//   confidence: high | medium | low
//   todos:      N
//   notes:      <one line: anything Phase B needs to know>
// ──────────────────────────────────────────────────────────────────────────
```

`confidence: low` means "logic is probably wrong, re-read the Zig in Phase B".
`medium` means "types/imports will need fixing but logic is right".
`high` means "should compile with only mechanical import fixes".