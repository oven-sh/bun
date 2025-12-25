---
name: zig-system-calls
description: Guides using bun.sys for system calls and file I/O in Zig. Use when implementing file operations, sockets, or process management instead of std.fs or std.posix.
---

# System Calls & File I/O in Zig

Use `bun.sys` instead of `std.fs` or `std.posix` for cross-platform syscalls with proper error handling.

## Why bun.sys?

| Aspect | bun.sys | std.fs/std.posix |
|--------|---------|------------------|
| Return Type | `Maybe(T)` with detailed Error | Generic error union |
| Windows | Full support with libuv fallback | Limited/POSIX-only |
| Error Info | errno, syscall tag, path, fd | errno only |
| EINTR | Automatic retry | Manual handling |

## Error Handling with Maybe(T)

`bun.sys` functions return `Maybe(T)` - a tagged union:

```zig
const sys = bun.sys;

// Pattern 1: Switch on result/error
switch (sys.read(fd, buffer)) {
    .result => |bytes_read| {
        // use bytes_read
    },
    .err => |err| {
        // err.errno, err.syscall, err.fd, err.path
        if (err.getErrno() == .AGAIN) {
            // handle EAGAIN
        }
    },
}

// Pattern 2: Unwrap with try (converts to Zig error)
const bytes = try sys.read(fd, buffer).unwrap();

// Pattern 3: Unwrap with default
const value = sys.stat(path).unwrapOr(default_stat);
```

## File Operations

### Opening Files

```zig
const sys = bun.sys;

// Use bun.O flags (cross-platform normalized)
const fd = switch (sys.open(path, bun.O.RDONLY, 0)) {
    .result => |fd| fd,
    .err => |err| return .{ .err = err },
};
defer fd.close();

// Common flags
bun.O.RDONLY, bun.O.WRONLY, bun.O.RDWR
bun.O.CREAT, bun.O.TRUNC, bun.O.APPEND
bun.O.NONBLOCK, bun.O.DIRECTORY
```

### Reading & Writing

```zig
// Single read (may return less than buffer size)
switch (sys.read(fd, buffer)) {
    .result => |n| { /* n bytes read */ },
    .err => |err| { /* handle error */ },
}

// Read until EOF or buffer full
const total = try sys.readAll(fd, buffer).unwrap();

// Position-based read/write
sys.pread(fd, buffer, offset)
sys.pwrite(fd, data, offset)

// Vector I/O
sys.readv(fd, iovecs)
sys.writev(fd, iovecs)
```

### bun.sys.File Wrapper

Higher-level file abstraction:

```zig
const File = bun.sys.File;

const file = switch (File.open(path, bun.O.RDWR, 0o644)) {
    .result => |f| f,
    .err => |err| return .{ .err = err },
};
defer file.close();

// Read/write
_ = try file.read(buffer).unwrap();
_ = try file.writeAll(data).unwrap();

// Get file info
const stat = try file.stat().unwrap();
const size = try file.getEndPos().unwrap();

// std.io compatible
const reader = file.reader();
const writer = file.writer();
```

### File Info

```zig
sys.stat(path)      // Follow symlinks
sys.lstat(path)     // Don't follow symlinks
sys.fstat(fd)       // From file descriptor

// Linux-only: faster selective stat
sys.statx(path, &.{ .size, .mtime })
```

### Path Operations

```zig
sys.unlink(path)
sys.rename(from, to)
sys.readlink(path, buf)
sys.link(src, dest)
sys.mkdir(path, mode)
sys.rmdir(path)

// *at variants (relative to directory fd)
sys.openat(dir_fd, path, flags, mode)
sys.unlinkat(dir_fd, path)
sys.renameat(from_dir, from, to_dir, to)
```

### Permissions

```zig
sys.chmod(path, mode)
sys.fchmod(fd, mode)
sys.chown(path, uid, gid)
sys.fchown(fd, uid, gid)
```

## Closing File Descriptors

Close is on `bun.FD`:

```zig
fd.close();  // Asserts on error (use in defer)

// Or if you need error info:
if (fd.closeAllowingBadFileDescriptor(null)) |err| {
    // handle error
}
```

## Socket Operations

```zig
sys.bind(fd, addr, addrlen)
sys.listen(fd, backlog)
sys.accept(fd, addr, addrlen)
sys.connect(fd, addr, addrlen)
sys.send(fd, buf, flags)
sys.recv(fd, buf, flags)
sys.setsockopt(fd, level, optname, optval)
```

## Process Operations

```zig
sys.posix_spawn(...)
sys.waitpid(pid, options)
sys.kill(pid, sig)
```

## Directory Operations

```zig
var buf: bun.PathBuffer = undefined;
const cwd = try sys.getcwd(&buf).unwrap();
sys.chdir(path)
```

## Complete Example

```zig
pub fn writeFile(path: [:0]const u8, data: []const u8) bun.sys.Maybe(void) {
    const file = switch (bun.sys.File.open(
        path,
        bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC,
        0o664,
    )) {
        .result => |f| f,
        .err => |err| return .{ .err = err },
    };
    defer file.close();

    switch (file.writeAll(data)) {
        .result => {},
        .err => |err| return .{ .err = err },
    }

    return .success;
}
```

## Error Type

```zig
const err: bun.sys.Error = ...;
err.errno      // Raw errno value
err.getErrno() // As std.posix.E enum
err.syscall    // Which syscall failed (Tag enum)
err.fd         // Optional: file descriptor
err.path       // Optional: path string
```

## Key Points

- Always use `bun.sys` over `std.fs`/`std.posix` for cross-platform code
- Use `bun.O.*` flags instead of `std.os.O.*`
- Handle `Maybe(T)` with switch or `.unwrap()`
- Use `defer fd.close()` for cleanup
- EINTR is handled automatically in most functions
