---
name: rust-system-calls
description: Guides using bun_sys for system calls and file I/O in Rust. Use when implementing file operations, opening fds, or any syscall path instead of std::fs or libc.
---

# System Calls & File I/O in Rust

Use `bun_sys` instead of `std::fs` or raw `libc` for cross-platform syscalls with proper error handling.

## bun_sys::File (Preferred)

For most file operations, use the `bun_sys::File` wrapper. It owns the fd and closes on `Drop`.

```rust
use bun_sys::{File, Fd, O};

let file = File::openat(Fd::cwd(), b"path/to/file", O::RDONLY, 0)?;
let mut buf = vec![0u8; 4096];
let n = file.read_all(&mut buf)?;     // loops until EOF or full
// `file` closes on Drop.
```

### Complete Example

```rust
use bun_sys::{File, Fd, O};

pub fn write_file(path: &[u8], data: &[u8]) -> Result<(), bun_sys::Error> {
    let file = File::openat(Fd::cwd(), path, O::WRONLY | O::CREAT | O::TRUNC, 0o664)?;
    file.write_all(data)?;
    Ok(())
}
```

## Why bun_sys?

| Aspect      | bun_sys                            | std::fs / libc         |
| ----------- | ---------------------------------- | ---------------------- |
| Return Type | `Maybe<T>` with rich `Error`       | `io::Error` (lossy)    |
| Windows     | Full support with libuv fallback   | Incomplete/POSIX-ish   |
| Error Info  | errno, syscall tag, path, fd       | errno only             |
| EINTR       | Automatic retry                    | Manual handling        |
| Paths       | `&[u8]` (WTF-8 safe)               | `&Path` (UTF-8 lossy)  |

## Error Handling with Maybe<T>

`bun_sys` functions return `Maybe<T> = Result<T, bun_sys::Error>`. Propagate with `?`; convert to a JS exception via `bun_sys_jsc::ErrorJsc::to_js`:

```rust
use bun_sys_jsc::ErrorJsc;
use bun_sys::{File, Fd, O};

let file = match File::openat(Fd::cwd(), path, O::RDONLY, 0) {
    Ok(f) => f,
    Err(err) => return Ok(err.to_js(global)?),
};
```

`bun_sys::Error` carries `errno`, `syscall: Tag`, and `path: Box<[u8]>`. To branch on errno:

```rust
match bun_sys::unlink(path) {
    Ok(()) => {}
    Err(e) if e.errno() == bun_c::ENOENT => {} // already gone
    Err(e) => return Err(e),
}
```

## Key Types and Functions

- `Fd` (`bun_core::Fd`) — cross-platform file descriptor. `Fd::cwd()`, `Fd::stdin()/stdout()/stderr()`, `fd.close()`.
- `File::open(path: &ZStr, flags, mode)` / `File::openat(dir: Fd, path: &[u8], flags, mode)` / `File::make_open(...)` (creates parent dirs) / `File::create(dir, path, truncate)`
- `file.read(buf)` / `read_all(buf)` / `read_to_end()` / `read_to_end_small()` / `write(buf)` / `write_all(buf)`
- `bun_sys::open`, `read`, `write`, `pread`, `pwrite`, `stat`, `fstat`, `lstat`, `mkdir`, `unlink`, `rename`, `symlink`, `chmod` — free fns over `Fd`
- Open flags: `bun_sys::O::RDONLY`, `O::WRONLY | O::CREAT | O::TRUNC`, etc.

## Path Buffers

Use `bun_paths` for joining/normalization and the path-buffer pool to avoid 64 KB stack allocations on Windows:

```rust
use bun_paths::{path_buffer_pool, resolve_path::{self, platform}};

let mut buf = path_buffer_pool::get();
let joined = resolve_path::join_string_buf::<platform::Auto>(&mut *buf, &[dir, name]);
let file = File::openat(Fd::cwd(), joined, O::RDONLY, 0)?;
```

## Common Mistakes

- **Don't `.unwrap()`** a `bun_sys` result that user input or the OS can cause to fail at runtime — return the error.
- **Don't use `std::fs::File`** — it loses the syscall tag and path needed for Node-compatible error objects.
- **Don't allocate `PathBuffer` on the stack** in hot paths — use `path_buffer_pool::get()`.
- **Don't forget `Drop`** alone closes a `File` — never `file.fd().close()` while the `File` is still live (double close).

See `src/CLAUDE.md` for the full `bun_core`/`bun_sys` reference.
