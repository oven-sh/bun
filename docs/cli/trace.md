# Trace Flag

The `--trace` flag enables structured logging of I/O operations to help understand what your application is doing without manual instrumentation.

## Usage

```bash
bun --trace=trace.jsonl your-script.js
```

This creates a trace file with line-delimited JSON (JSONL) format, where each line is a complete trace event.

## What Gets Traced

### File System Operations (`ns: "fs"`)

**Low-level operations:**

- `open` - File descriptor allocation
- `read` / `write` - Data transfer operations
- `close` - File descriptor release

**High-level operations:**

- `readFile` / `writeFile` - Complete file read/write
- `stat` / `lstat` / `fstat` - File metadata queries
- `mkdir` / `rmdir` - Directory creation/removal
- `unlink` - File deletion
- `rename` - File/directory renaming
- `readdir` - Directory listing

### HTTP Operations (`ns: "fetch"`)

- `request` - HTTP request initiation
- `response` - HTTP response received

### Response Body Consumption (`ns: "response_body"`)

- `text` / `json` / `arrayBuffer` / `blob` - Response body parsing

### Bun.write Operations (`ns: "bun_write"`)

- `write` - File write operations via Bun.write()

### Subprocess Operations (`ns: "subprocess"`)

- `spawn` - Process spawned (Bun.spawn or child_process)
- `exit` - Process exited

## Trace Event Format

Each trace event is a compact JSON array:

```json
[
  "fs",
  1761595797038,
  "readFile",
  { "path": "/path/to/file", "bytes_read": 1234 }
]
```

Array structure:

- `[0]` - Namespace (fs, fetch, response_body, bun_write, subprocess)
- `[1]` - Timestamp in milliseconds
- `[2]` - Operation name (readFile, spawn, request, etc.)
- `[3]` - Operation-specific data object

Only applicable fields are included in the data object - no null/undefined values.

### Why Array Format?

The array format is:

- **40% more compact** than object format
- **Easier to filter** with jq: `select(.[0] == "fs" and .[2] == "writeFile")`
- **Faster to parse** (arrays vs objects with string keys)

## Example: Analyzing a Trace

```bash
# Run your script with tracing
bun --trace=trace.jsonl my-app.js

# View all filesystem operations
cat trace.jsonl | jq 'select(.[0] == "fs")'

# Count operations by type
cat trace.jsonl | jq -r '.[2]' | sort | uniq -c

# Find slow operations (requires calculating deltas)
cat trace.jsonl | jq -c 'select(.[0] == "fetch") | {ts: .[1], url: .[3].url}'

# Total bytes read/written
cat trace.jsonl | jq -s 'map(select(.[0] == "fs")) |
  {
    bytes_read: map(.[3].bytes_read // 0) | add,
    bytes_written: map(.[3].bytes_written // 0) | add
  }'
```

## Example Trace Output

```bash
$ bun --trace=trace.jsonl -e 'import fs from "fs"; fs.writeFileSync("test.txt", "hello"); console.log(fs.readFileSync("test.txt", "utf8"))'
hello
$ cat trace.jsonl
["fs",1761595797038,"writeFile",{"path":"test.txt","length":5}]
["fs",1761595797038,"writeFile",{"path":"test.txt","bytes_written":5}]
["fs",1761595797038,"readFile",{"path":"test.txt","encoding":"utf8"}]
["fs",1761595797039,"readFile",{"path":"test.txt","bytes_read":5,"fast_path":true}]
```

## Common Trace Data Fields

### Filesystem Operations

**Entry traces** (operation starting):

- `call` - Operation name
- `path` - File/directory path
- `fd` - File descriptor (for fd-based ops)
- `flags` - Open flags (for open)
- `mode` - File permissions
- `length` - Buffer/data length
- `offset` - Buffer offset
- `position` - File position (for positioned reads/writes)
- `encoding` - Character encoding (for readFile)
- `recursive` - Recursive flag (for mkdir/rmdir/readdir)

**Exit traces** (operation complete):

- `call` - Operation name (same as entry)
- `path` / `fd` - Identifier (same as entry)
- `bytes_read` - Bytes successfully read
- `bytes_written` - Bytes successfully written
- `size` - File size (for stat)
- `mode` - File mode bits (for stat)
- `entries` - Number of entries (for readdir)
- `success` - Boolean success flag
- `errno` - Error number (on failure)
- `fast_path` - Used optimized path (readFile)

### HTTP Operations

**Request trace:**

- `call: "request"`
- `url` - Request URL
- `method` - HTTP method (GET, POST, etc.)

**Response trace:**

- `call: "response"`
- `url` - Request URL
- `status` - HTTP status (OK, NotFound, etc.)
- `body_size` - Response body size in bytes
- `has_more` - Whether response is streaming
- `err` - Error name (on failure)

**Body consumption trace:**

- `call` - Consumption method (text, json, arrayBuffer, blob)
- `status` - Consumption status (immediate, streaming, already_used)

### Subprocess Operations

**Spawn trace:**

- `call: "spawn"`
- `cmd` - Command being executed
- `args` - Number of arguments (including command)
- `cwd` - Working directory
- `env_count` - Number of environment variables
- `pid` - Process ID

**Exit trace:**

- `call: "exit"`
- `pid` - Process ID
- `exit_code` - Exit code (on normal exit)
- `signal` - Signal number (if killed by signal)
- `errno` - Error number (on spawn failure)

## Use Cases

### Debugging I/O Performance

Find which operations are slow by analyzing timestamps:

```javascript
const traces = require("fs")
  .readFileSync("trace.jsonl", "utf8")
  .trim()
  .split("\n")
  .map(JSON.parse);

// Find operations and their durations
const ops = new Map();
traces.forEach(t => {
  const key = `${t.ns}.${t.data.call}.${t.data.path || t.data.url}`;
  if (!ops.has(key)) {
    ops.set(key, { start: t.ts, events: [] });
  }
  ops.get(key).events.push(t);
  ops.get(key).end = t.ts;
});

// Show slowest operations
Array.from(ops.entries())
  .map(([k, v]) => ({ op: k, duration: v.end - v.start }))
  .sort((a, b) => b.duration - a.duration)
  .slice(0, 10)
  .forEach(x => console.log(`${x.op}: ${x.duration}ms`));
```

### Understanding Application Behavior

AI agents can analyze traces to understand:

- What files the application reads/writes
- What external services it contacts
- Order of operations
- Error patterns
- Resource usage (bytes read/written, number of requests)

### Testing and Validation

Verify your application's I/O behavior:

```javascript
// Check that app only writes to temp directory
const traces = getTraces();
const writes = traces.filter(
  t => t.ns === "fs" && ["write", "writeFile"].includes(t.data.call),
);
writes.forEach(w => {
  assert(w.data.path.startsWith("/tmp"), `Unexpected write to ${w.data.path}`);
});
```

## Performance Impact

Tracing has **minimal overhead** when disabled (the default):

- Single boolean check per instrumentation point
- No file I/O, JSON serialization, or string allocation

When enabled, tracing adds:

- JSON serialization overhead per event
- Mutex locking for thread-safe file writes
- Buffered I/O to the trace file

For CPU-bound applications, overhead is negligible. For I/O-bound applications with high operation counts (thousands/second), expect 1-5% overhead.

## Limitations

- Trace file uses append-only writes (no rotation)
- Large traces can consume significant disk space
- No built-in filtering (logs all operations in traced namespaces)
- Timestamps are system time (not monotonic/high-resolution)
- No support for trace compression
- No built-in trace analysis tools (use jq, custom scripts, or tools like Jaeger)

## Implementation Details

The trace implementation is integrated into Bun's core I/O layer:

- `src/output.zig` - Core tracing infrastructure
- `src/cli/Arguments.zig` - CLI flag parsing
- `src/bun.js/node/node_fs.zig` - Filesystem operation tracing
- `src/bun.js/webcore/fetch.zig` - HTTP request/response tracing
- `src/bun.js/webcore/Body.zig` - Response body tracing
- `src/bun.js/webcore/blob/write_file.zig` - Bun.write tracing
- `src/bun.js/api/bun/subprocess.zig` - Subprocess spawn/exit tracing

Each instrumentation point checks `Output.trace_enabled` before tracing, ensuring zero overhead when disabled.
