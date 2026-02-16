## Zig

Syntax reminders:

- Private fields are fully supported in Zig with the `#` prefix. `struct { #foo: u32 };` makes a struct with a private field named `#foo`.
- Decl literals in Zig are recommended. `const decl: Decl = .{ .binding = 0, .value = 0 };`

Conventions:

- Prefer `@import` at the **bottom** of the file, but the auto formatter will move them so you don't need to worry about it.
- **Never** use `@import()` inline inside of functions. **Always** put them at the bottom of the file or containing struct. Imports in Zig are free of side-effects, so there's no such thing as a "dynamic" import.
- You must be patient with the build.

## Prefer Bun APIs over `std`

**Always use `bun.*` APIs instead of `std.*`.** The `bun` namespace (`@import("bun")`) provides cross-platform wrappers that preserve OS error info and never use `unreachable`. Using `std.fs`, `std.posix`, or `std.os` directly is wrong in this codebase.

| Instead of                                                   | Use                                  |
| ------------------------------------------------------------ | ------------------------------------ |
| `std.fs.File`                                                | `bun.sys.File`                       |
| `std.fs.cwd()`                                               | `bun.FD.cwd()`                       |
| `std.posix.open/read/write/stat/mkdir/unlink/rename/symlink` | `bun.sys.*` equivalents              |
| `std.fs.path.join/dirname/basename`                          | `bun.path.join/dirname/basename`     |
| `std.mem.eql/indexOf/startsWith` (for strings)               | `bun.strings.eql/indexOf/startsWith` |
| `std.posix.O` / `std.posix.mode_t` / `std.posix.fd_t`        | `bun.O` / `bun.Mode` / `bun.FD`      |
| `std.process.Child`                                          | `bun.spawnSync`                      |
| `catch bun.outOfMemory()`                                    | `bun.handleOom(...)`                 |

## `bun.sys` — System Calls (`src/sys.zig`)

All return `Maybe(T)` — a tagged union of `.result: T` or `.err: bun.sys.Error`:

```zig
const fd = switch (bun.sys.open(path, bun.O.RDONLY, 0)) {
    .result => |fd| fd,
    .err => |err| return .{ .err = err },
};
// Or: const fd = try bun.sys.open(path, bun.O.RDONLY, 0).unwrap();
```

Key functions (all take `bun.FileDescriptor`, not `std.posix.fd_t`):

- `open`, `openat`, `openA` (non-sentinel) → `Maybe(bun.FileDescriptor)`
- `read`, `readAll`, `pread` → `Maybe(usize)`
- `write`, `pwrite`, `writev` → `Maybe(usize)`
- `stat`, `fstat`, `lstat` → `Maybe(bun.Stat)`
- `mkdir`, `unlink`, `rename`, `symlink`, `chmod`, `fchmod`, `fchown` → `Maybe(void)`
- `readlink`, `getFdPath`, `getcwd` → `Maybe` of path slice
- `getFileSize`, `dup`, `sendfile`, `mmap`

Use `bun.O.RDONLY`, `bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC`, etc. for open flags.

### `bun.sys.File` (`src/sys/File.zig`)

Higher-level file handle wrapping `bun.FileDescriptor`:

```zig
// One-shot read: open + read + close
const bytes = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, allocator)) {
    .result => |b| b,
    .err => |err| return .{ .err = err },
};

// One-shot write: open + write + close
switch (bun.sys.File.writeFile(bun.FD.cwd(), path, data)) {
    .result => {},
    .err => |err| return .{ .err = err },
}
```

Key methods:

- `File.open/openat/makeOpen` → `Maybe(File)` (`makeOpen` creates parent dirs)
- `file.read/readAll/write/writeAll` — single or looped I/O
- `file.readToEnd(allocator)` — read entire file into allocated buffer
- `File.readFrom(dir_fd, path, allocator)` — open + read + close
- `File.writeFile(dir_fd, path, data)` — open + write + close
- `file.stat()`, `file.close()`, `file.writer()`, `file.reader()`

### `bun.FD` (`src/fd.zig`)

Cross-platform file descriptor. Use `bun.FD.cwd()` for cwd, `bun.invalid_fd` for sentinel, `fd.close()` to close.

### `bun.sys.Error` (`src/sys/Error.zig`)

Preserves errno, syscall tag, and file path. Convert to JS: `err.toSystemError().toErrorInstance(globalObject)`.

## `bun.strings` — String Utilities (`src/string/immutable.zig`)

SIMD-accelerated string operations. Use instead of `std.mem` for strings.

```zig
// Searching
strings.indexOf(haystack, needle)         // ?usize
strings.contains(haystack, needle)        // bool
strings.containsChar(haystack, char)      // bool
strings.indexOfChar(haystack, char)       // ?u32
strings.indexOfAny(str, comptime chars)   // ?OptionalUsize (SIMD-accelerated)

// Comparison
strings.eql(a, b)                                    // bool
strings.eqlComptime(str, comptime literal)            // bool — optimized
strings.eqlCaseInsensitiveASCII(a, b, comptime true)  // 3rd arg = check_len

// Prefix/Suffix
strings.startsWith(str, prefix)                    // bool
strings.endsWith(str, suffix)                      // bool
strings.hasPrefixComptime(str, comptime prefix)    // bool — optimized
strings.hasSuffixComptime(str, comptime suffix)    // bool — optimized

// Trimming
strings.trim(str, comptime chars)    // strip from both ends
strings.trimSpaces(str)              // strip whitespace

// Encoding conversions
strings.toUTF8Alloc(allocator, utf16)          // ![]u8
strings.toUTF16Alloc(allocator, utf8)          // !?[]u16
strings.toUTF8FromLatin1(allocator, latin1)    // !?Managed(u8)
strings.firstNonASCII(slice)                   // ?u32
```

Bun handles UTF-8, Latin-1, and UTF-16/WTF-16 because JSC uses Latin-1 and UTF-16 internally. Latin-1 is NOT UTF-8 — bytes 128-255 are single chars in Latin-1 but invalid UTF-8.

### `bun.String` (`src/string.zig`)

Bridges Zig and JavaScriptCore. Prefer over `ZigString` in new code.

```zig
const s = bun.String.cloneUTF8(utf8_slice);    // copies into WTFStringImpl
const s = bun.String.borrowUTF8(utf8_slice);   // no copy, caller keeps alive
const utf8 = s.toUTF8(allocator);              // ZigString.Slice
defer utf8.deinit();
const js_value = s.toJS(globalObject);

// Create a JS string value directly from UTF-8 bytes:
const js_str = try bun.String.createUTF8ForJS(globalObject, utf8_slice);
```

## `bun.path` — Path Manipulation (`src/resolver/resolve_path.zig`)

Use instead of `std.fs.path`. Platform param: `.auto` (current platform), `.posix`, `.windows`, `.loose` (both separators).

```zig
// Join paths — uses threadlocal buffer, result must be copied if it needs to persist
bun.path.join(&.{ dir, filename }, .auto)
bun.path.joinZ(&.{ dir, filename }, .auto)  // null-terminated

// Join into a caller-provided buffer
bun.path.joinStringBuf(&buf, &.{ a, b }, .auto)
bun.path.joinStringBufZ(&buf, &.{ a, b }, .auto)  // null-terminated

// Resolve against an absolute base (like Node.js path.resolve)
bun.path.joinAbsString(cwd, &.{ relative_path }, .auto)
bun.path.joinAbsStringBufZ(cwd, &buf, &.{ relative_path }, .auto)

// Path components
bun.path.dirname(path, .auto)
bun.path.basename(path)

// Relative path between two absolute paths
bun.path.relative(from, to)
bun.path.relativeAlloc(allocator, from, to)

// Normalize (resolve `.` and `..`)
bun.path.normalizeBuf(path, &buf, .auto)

// Null-terminate a path into a buffer
bun.path.z(path, &buf)  // returns [:0]const u8
```

Use `bun.PathBuffer` for path buffers: `var buf: bun.PathBuffer = undefined;`

For pooled path buffers (avoids 64KB stack allocations on Windows):

```zig
const buf = bun.path_buffer_pool.get();
defer bun.path_buffer_pool.put(buf);
```

## URL Parsing

Prefer `bun.jsc.URL` (WHATWG-compliant, backed by WebKit C++) over `bun.URL.parse` (internal, doesn't properly handle errors or invalid URLs).

```zig
// Parse a URL string (returns null if invalid)
const url = bun.jsc.URL.fromUTF8(href_string) orelse return error.InvalidURL;
defer url.deinit();

url.protocol()   // bun.String
url.pathname()   // bun.String
url.search()     // bun.String
url.hash()       // bun.String (includes leading '#')
url.port()       // u32 (maxInt(u32) if not set, otherwise u16 range)

// NOTE: host/hostname are SWAPPED vs JS:
url.host()       // hostname WITHOUT port (opposite of JS!)
url.hostname()   // hostname WITH port (opposite of JS!)

// Normalize a URL string (percent-encode, punycode, etc.)
const normalized = bun.jsc.URL.hrefFromString(bun.String.borrowUTF8(input));
if (normalized.tag == .Dead) return error.InvalidURL;
defer normalized.deref();

// Join base + relative URLs
const joined = bun.jsc.URL.join(base_str, relative_str);
defer joined.deref();

// Convert between file paths and file:// URLs
const file_url = bun.jsc.URL.fileURLFromString(path_str);     // path → file://
const file_path = bun.jsc.URL.pathFromFileURL(url_str);       // file:// → path
```

## MIME Types (`src/http/MimeType.zig`)

```zig
const MimeType = bun.http.MimeType;

// Look up by file extension (without leading dot)
const mime = MimeType.byExtension("html");          // MimeType{ .value = "text/html", .category = .html }
const mime = MimeType.byExtensionNoDefault("xyz");  // ?MimeType (null if unknown)

// Category checks
mime.category  // .javascript, .css, .html, .json, .image, .text, .wasm, .font, .video, .audio, ...
mime.category.isCode()
```

Common constants: `MimeType.javascript`, `MimeType.json`, `MimeType.html`, `MimeType.css`, `MimeType.text`, `MimeType.wasm`, `MimeType.ico`, `MimeType.other`.

## Memory & Allocators

**Use `bun.default_allocator` for almost everything.** It's backed by mimalloc.

`bun.handleOom(expr)` converts `error.OutOfMemory` into a crash without swallowing other errors:

```zig
const buf = bun.handleOom(allocator.alloc(u8, size));  // correct
// NOT: allocator.alloc(u8, size) catch bun.outOfMemory()  — could swallow non-OOM errors
```

## Environment Variables (`src/env_var.zig`)

Type-safe, cached environment variable accessors via `bun.env_var`:

```zig
bun.env_var.HOME.get()                              // ?[]const u8
bun.env_var.CI.get()                                // ?bool
bun.env_var.BUN_CONFIG_DNS_TIME_TO_LIVE_SECONDS.get() // u64 (has default: 30)
```

## Logging (`src/output.zig`)

```zig
const log = bun.Output.scoped(.MY_FEATURE, .visible);  // .hidden = opt-in via BUN_DEBUG_MY_FEATURE=1
log("processing {d} items", .{count});

// Color output (convenience wrappers auto-detect TTY):
bun.Output.pretty("<green>success<r>: {s}\n", .{msg});
bun.Output.prettyErrorln("<red>error<r>: {s}", .{msg});
```

## Spawning Subprocesses (`src/bun.js/api/bun/process.zig`)

Use `bun.spawnSync` instead of `std.process.Child`:

```zig
switch (bun.spawnSync(&.{
    .argv = argv,
    .envp = null, // inherit parent env
    .cwd = cwd,
    .stdout = .buffer,   // capture
    .stderr = .inherit,  // pass through
    .stdin = .ignore,

    .windows = if (bun.Environment.isWindows) .{
        .loop = bun.jsc.EventLoopHandle.init(bun.jsc.MiniEventLoop.initGlobal(env, null)),
    },
}) catch return) {
    .err => |err| { /* bun.sys.Error */ },
    .result => |result| {
        defer result.deinit();
        const stdout = result.stdout.items;
        if (result.status.isOK()) { ... }
    },
}
```

Options: `argv: []const []const u8`, `envp: ?[*:null]?[*:0]const u8` (null = inherit), `argv0: ?[*:0]const u8`. Stdio: `.inherit`, `.ignore`, `.buffer`.

## Common Patterns

```zig
// Read a file
const contents = switch (bun.sys.File.readFrom(bun.FD.cwd(), path, allocator)) {
    .result => |bytes| bytes,
    .err => |err| { globalObject.throwValue(err.toSystemError().toErrorInstance(globalObject)); return .zero; },
};

// Create directories recursively
bun.makePath(dir.stdDir(), sub_path) catch |err| { ... };

// Hashing
bun.hash(bytes)    // u64 — wyhash
bun.hash32(bytes)  // u32
```
