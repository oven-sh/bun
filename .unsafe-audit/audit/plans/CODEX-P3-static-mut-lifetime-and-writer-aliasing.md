# CODEX-P3 Plan — Static Mutable References and Scratch-Buffer Lifetimes

## Problem

Several Rust APIs preserve Zig's "global/threadlocal scratch buffer" style by
returning normal Rust references with too-long lifetimes. This is risky because
Rust references carry aliasing and lifetime promises that Zig slices do not.

Two subclusters matter most:

1. `&'static mut` writer accessors.
2. shared slice references into thread-local or FFI scratch buffers.

## Cluster A — `Output::*writer()` returns `&'static mut`

File: `src/bun_core/output.rs:1067-1109`.

Current API:

```rust
pub fn error_writer() -> &'static mut io::Writer
pub fn error_writer_buffered() -> &'static mut io::Writer
pub fn error_stream() -> &'static mut io::Writer
pub fn writer() -> &'static mut io::Writer
pub fn writer_buffered() -> &'static mut io::Writer
```

The implementation escapes a `thread_local!` borrow:

```rust
let p: *mut io::Writer = SOURCE.with_borrow_mut(|s| std::ptr::from_mut(project(s)));
unsafe { &mut *p }
```

The comment already says the shape is unsound if two references are alive at
once.

### PR A1 — add closure APIs

Add:

```rust
pub fn with_error_writer<R>(f: impl FnOnce(&mut io::Writer) -> R) -> R
pub fn with_error_writer_buffered<R>(f: impl FnOnce(&mut io::Writer) -> R) -> R
pub fn with_writer<R>(f: impl FnOnce(&mut io::Writer) -> R) -> R
pub fn with_writer_buffered<R>(f: impl FnOnce(&mut io::Writer) -> R) -> R
```

These should keep the `RefCell` borrow active for the closure duration and
prevent escape.

### PR A2 — migrate easy call sites

Good first targets are one-line writes:

```rust
Output::error_writer().write_all(...)
Output::writer().print(...)
```

Convert to:

```rust
Output::with_error_writer(|w| w.write_all(...))
Output::with_writer(|w| w.print(...))
```

### PR A3 — downgrade legacy APIs

After migration, either:

- make the old functions `unsafe fn`, or
- return `*mut io::Writer` and require callers to make the aliasing proof.

## Cluster B — scratch-buffer slices with "valid until next call" lifetime

Representative APIs:

### `ModKey::hash_name`

File: `src/resolver/fs.rs:1724-1744`.

Returns `Result<&'static [u8], _>` into `HASH_NAME_BUF`, with an in-source
comment that the lifetime is unsound.

Fix direction:

```rust
pub fn hash_name_into<'a>(&self, basename: &[u8], out: &'a mut [u8]) -> Result<&'a [u8], Error>
```

Keep a temporary wrapper only if every caller duplicates immediately.

### `HPACK::decode`

File: `src/http/lshpack.rs:32-105`.

`DecodeResult` exposes:

```rust
pub name: &'static [u8],
pub value: &'static [u8],
```

but the storage is an FFI thread-local shared buffer valid only until the next
decode/encode call.

Fix direction:

- `DecodeResult<'a>` tied to `&'a mut HPACK`, if the FFI buffer is truly tied to
  the decoder call and cannot be invalidated except through another mutable
  decode/encode call;
- or copy name/value into caller-owned buffers for simple correctness;
- or expose an unsafe raw view type named `DecodeResultBorrowedUntilNextCall`.

### `Repository::try_ssh` / `try_https`

File: `src/install/repository.rs:527-610`.

Returns `Option<&[u8]>` into thread-local `PathBuffer`s. The signature hides the
"until next call on this thread" rule.

Fix direction:

```rust
fn try_ssh_into<'a>(url: &[u8], out: &'a mut PathBuffer) -> Option<&'a [u8]>
fn try_https_into<'a>(url: &[u8], out: &'a mut PathBuffer) -> Option<&'a [u8]>
```

### `resolve_path::normalize_string`

File: `src/paths/resolve_path.rs:1393-1407`.

Returns mutable slices into `PARSER_BUFFER`. The output lifetime is not visibly
tied to a caller-owned buffer.

Fix direction:

- Prefer the existing `normalize_buf` / `normalize_buf_z` in new callers.
- Deprecate or make unsafe the TLS-returning variants.

## Verification

1. Add a source-level lint script to flag new safe APIs returning:
   - `&'static mut`;
   - `&'static [u8]` from `thread_local!` / `RacyCell` / `detach_lifetime`;
   - elided-output refs from functions with `thread_local` in the body.
2. Unit-test representative migrated APIs with two consecutive calls and assert
   the first value remains valid only when owned/copied.
3. Run targeted Bun tests for:
   - bundler hashed filenames;
   - package manager git URL normalization;
   - HTTP/2 HPACK decode paths;
   - CLI output formatting.

## Review posture

This cluster should be sold as "make the Rust type signatures tell the truth."
It is not accusing the current call sites of all being wrong; it is saying the
safe APIs are too powerful and therefore cannot be reviewed locally.
