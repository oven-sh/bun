---
name: zig-system-calls
description: Guides using bun.sys for system calls and file I/O in Zig. Use when implementing file operations instead of std.fs or std.posix.
---

# System Calls & File I/O in Zig

Use `bun.sys` instead of `std.fs` or `std.posix` for cross-platform syscalls with proper error handling.

## bun.sys.File (Preferred)

For most file operations, use the `bun.sys.File` wrapper:

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

### Complete Example

```zig
const File = bun.sys.File;

pub fn writeFile(path: [:0]const u8, data: []const u8) File.WriteError!void {
    const file = switch (File.open(path, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o664)) {
        .result => |f| f,
        .err => |err| return err.toError(),
    };
    defer file.close();

    _ = switch (file.writeAll(data)) {
        .result => {},
        .err => |err| return err.toError(),
    };
}
```

## Why bun.sys?

| Aspect      | bun.sys                          | std.fs/std.posix    |
| ----------- | -------------------------------- | ------------------- |
| Return Type | `Maybe(T)` with detailed Error   | Generic error union |
| Windows     | Full support with libuv fallback | Limited/POSIX-only  |
| Error Info  | errno, syscall tag, path, fd     | errno only          |
| EINTR       | Automatic retry                  | Manual handling     |

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

## Low-Level File Operations

Only use these when `bun.sys.File` doesn't meet your needs.

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

### File Info

```zig
sys.stat(path)      // Follow symlinks
sys.lstat(path)     // Don't follow symlinks
sys.fstat(fd)       // From file descriptor
sys.fstatat(fd, path)

// Linux-only: faster selective stat
sys.statx(path, &.{ .size, .mtime })
```

### Path Operations

```zig
sys.unlink(path)
sys.unlinkat(dir_fd, path)
sys.rename(from, to)
sys.renameat(from_dir, from, to_dir, to)
sys.readlink(path, buf)
sys.readlinkat(fd, path, buf)
sys.link(T, src, dest)
sys.linkat(src_fd, src, dest_fd, dest)
sys.symlink(target, dest)
sys.symlinkat(target, dirfd, dest)
sys.mkdir(path, mode)
sys.mkdirat(dir_fd, path, mode)
sys.rmdir(path)
```

### Permissions

```zig
sys.chmod(path, mode)
sys.fchmod(fd, mode)
sys.fchmodat(fd, path, mode, flags)
sys.chown(path, uid, gid)
sys.fchown(fd, uid, gid)
```

### Closing File Descriptors

Close is on `bun.FD`:

```zig
fd.close();  // Asserts on error (use in defer)

// Or if you need error info:
if (fd.closeAllowingBadFileDescriptor(null)) |err| {
    // handle error
}
```

## Directory Operations

```zig
var buf: bun.PathBuffer = undefined;
const cwd = try sys.getcwd(&buf).unwrap();
const cwdZ = try sys.getcwdZ(&buf).unwrap();  // Zero-terminated
sys.chdir(path, destination)
```

### Directory Iteration

Use `bun.DirIterator` instead of `std.fs.Dir.Iterator`:

```zig
var iter = bun.iterateDir(dir_fd);
while (true) {
    switch (iter.next()) {
        .result => |entry| {
            if (entry) |e| {
                const name = e.name.slice();
                const kind = e.kind;  // .file, .directory, .sym_link, etc.
            } else {
                break;  // End of directory
            }
        },
        .err => |err| return .{ .err = err },
    }
}
```

## Socket Operations

**Important**: `bun.sys` has limited socket support. For network I/O:

- **Non-blocking sockets**: Use `uws.Socket` (libuwebsockets) exclusively
- **Pipes/blocking I/O**: Use `PipeReader.zig` and `PipeWriter.zig`

Available in bun.sys:

```zig
sys.setsockopt(fd, level, optname, value)
sys.socketpair(domain, socktype, protocol, nonblocking_status)
```

Do NOT use `bun.sys` for socket read/write - use `uws.Socket` instead.

## Other Operations

```zig
sys.ftruncate(fd, size)
sys.lseek(fd, offset, whence)
sys.dup(fd)
sys.dupWithFlags(fd, flags)
sys.fcntl(fd, cmd, arg)
sys.pipe()
sys.mmap(...)
sys.munmap(memory)
sys.access(path, mode)
sys.futimens(fd, atime, mtime)
sys.utimens(path, atime, mtime)
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

- Prefer `bun.sys.File` wrapper for most file operations
- Use low-level `bun.sys` functions only when needed
- Use `bun.O.*` flags instead of `std.os.O.*`
- Handle `Maybe(T)` with switch or `.unwrap()`
- Use `defer fd.close()` for cleanup
- EINTR is handled automatically in most functions
- For sockets, use `uws.Socket` not `bun.sys`
