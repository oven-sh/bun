# Bun Streams Architecture - Comprehensive Documentation

## Table of Contents

1. [Overview](#overview)
2. [Core Architecture](#core-architecture)
3. [Stream Types and Implementations](#stream-types-and-implementations)
4. [Component Deep Dive](#component-deep-dive)
5. [Data Flow Patterns](#data-flow-patterns)
6. [Memory Management](#memory-management)
7. [Performance Optimizations](#performance-optimizations)
8. [Integration Patterns](#integration-patterns)
9. [Implementation Examples](#implementation-examples)

## Overview

Bun's streaming architecture is a sophisticated, multi-layered system designed for maximum performance while maintaining compatibility with the WHATWG Streams specification. The implementation spans native Zig code, C++ bindings, and TypeScript, with a clear philosophy: use fast, native-level operations for common I/O paths and fall back to a spec-compliant JavaScript implementation for everything else. This hybrid approach allows Bun to achieve remarkable speed for tasks like file I/O and HTTP serving.

### Key Design Principles

- **Zero-copy & Minimal-copy operations** where possible to reduce memory overhead.
- **Lazy initialization** to avoid unnecessary work for streams that are not consumed.
- **Direct native paths** that bypass the JavaScript engine entirely when a native source is piped to a native sink.
- **Efficient memory management** with pooling for network buffers and explicit ownership tracking of data chunks.
- **Comprehensive backpressure support** throughout the system to prevent memory exhaustion.

## Core Architecture

### Layered Design

Bun's stream implementation is layered to separate concerns, from high-level JavaScript APIs to low-level system I/O.

```
┌─────────────────────────────────────┐
│     JavaScript API Layer            │  ReadableStream.ts, WritableStream.ts, Body Mixins
├─────────────────────────────────────┤
│     JavaScript Internal Layer       │  ReadableStreamInternals.ts, WritableStreamInternals.ts
├─────────────────────────────────────┤
│     Binding Layer (C++)             │  JSC bindings, generated code for private fields (BunBuiltinNames.h)
├─────────────────────────────────────┤
│     Native Stream Layer (Zig)       │  ReadableStream.zig, streams.zig
├─────────────────────────────────────┤
│     Sink/Source Implementations (Zig) │  ByteStream.zig, FileSink.zig, HTTPSResponseSink.zig
├─────────────────────────────────────┤
│     System I/O Layer                │  OS file/network operations (io_uring, kqueue, etc.)
└─────────────────────────────────────┘
```

## Stream Types and Implementations

The core of Bun's performance strategy lies in its ability to differentiate between stream types.

### 1. Direct Streams

Direct streams are Bun's high-performance mechanism, bypassing standard JavaScript machinery. They are used when Bun can manage both the data source and the sink natively.

**Initialization (`ReadableStream.ts`)**: A stream is marked as `direct` if its `underlyingSource` object has `type: "direct"`. This signals to the native layer to use a specialized, high-performance controller.

```javascript
// from ReadableStream.ts
if (isDirect) {
  $putByIdDirectPrivate(this, "underlyingSource", underlyingSource);
  $putByIdDirectPrivate(
    this,
    "highWaterMark",
    $getByIdDirectPrivate(strategy, "highWaterMark"),
  );
  $putByIdDirectPrivate(this, "start", () =>
    $createReadableStreamController(this, underlyingSource, strategy),
  );
}
```

**Controller Structure (`ReadableStreamInternals.ts`)**: The "direct" controller is a plain JS object that acts as a bridge to native code. It holds a reference to a native sink (e.g., `ArrayBufferSink`, `HTTPSResponseSink`) and orchestrates the data flow.

```javascript
// from ReadableStreamInternals.ts
const controller = {
  $underlyingSource: underlyingSource,
  $pull: $onPullDirectStream,
  $controlledReadableStream: stream,
  $sink: sink, // Native sink (e.g., ArrayBufferSink, TextSink)
  close: $onCloseDirectStream,
  write: sink.write, // Direct access to the native sink's write function
  error: $handleDirectStreamError,
  end: $onCloseDirectStream,
  flush: $onFlushDirectStream,
  _pendingRead: undefined, // Promise for pending read
  _deferClose: 0, // -1 during pull, 0 idle, 1 deferred
  _deferFlush: 0, // -1 during pull, 0 idle, 1 deferred
  // ...
};
```

**Pull Mechanism**: When the stream is pulled, `$onPullDirectStream` is called. It directly invokes the native `pull` method of the underlying source. To prevent re-entrancy issues, it uses `_deferClose` and `_deferFlush` flags to queue operations that occur while a pull is already in progress.

### 2. Default Streams (JavaScript Streams)

This is the standard WHATWG streams implementation, used when the data source is a generic JavaScript object. It provides full spec compliance at the cost of performance.

**Controller Types**:

- `ReadableStreamDefaultController`: For general-purpose object/string streams.
- `ReadableByteStreamController`: For byte-oriented streams with BYOB (Bring Your Own Buffer) support.

**Initialization Path (`ReadableStreamInternals.ts`)**: A standard stream is set up by creating a controller and passing it the user-defined `start`, `pull`, and `cancel` algorithms.

```javascript
$setupReadableStreamDefaultController(
  stream,
  underlyingSource,
  size,
  highWaterMark,
  underlyingSource.start,
  underlyingSource.pull,
  underlyingSource.cancel,
);
```

### 3. Native-Backed Sources

When a stream is created from a known native source like `Bun.file()`, it's tagged to enable optimizations, even if consumed via the default path.

#### **ByteStream (`ByteStream.zig`)**

This is the workhorse for network I/O. It efficiently buffers incoming byte data.

**Structure**:

```zig
pub const ByteStream = struct {
    buffer: std.ArrayList(u8),
    has_received_last_chunk: bool,
    pending: streams.Result.Pending, // For pending pull requests
    // ...
    pipe: Pipe, // For direct native-to-native piping
    buffer_action: ?BufferAction, // For .text(), .json(), etc.
};
```

**`onData` Method**: This is the core data ingestion logic.

- **Pipe Mechanism**: If a native sink is piped (`this.pipe.ctx` is set), `onData` immediately forwards the `streams.Result` to the sink's `onPipe` function, achieving a zero-copy handoff.
- **Buffer Action**: If the stream is being fully consumed (e.g., via `response.text()`), `buffer_action` is set. `onData` appends chunks to the internal buffer until the `_and_done` flag is received, at which point it fulfills the promise with the complete data.
- **Pending Pull**: If a JS consumer is actively pulling (`this.pending.state == .pending`), `onData` writes the chunk directly into the consumer's buffer and fulfills the read promise.
- **Default**: If there's no active consumer, it appends the chunk to its internal `buffer`.

#### **Stream Source Types (`ReadableStream.zig`)**

The `Source` union is used by the native layer to represent the stream's origin. This is how Bun's native code knows what kind of source it's dealing with.

```zig
// from ReadableStream.zig
pub const Source = union(Tag) {
    Invalid: void,
    JavaScript: void,              // Standard JS stream
    Blob: *webcore.ByteBlobLoader, // Blob-backed stream
    File: *webcore.FileReader,     // File-backed stream
    Direct: void,                  // Direct native stream (unused for tagging)
    Bytes: *webcore.ByteStream,    // A network or raw byte stream
};
```

## Component Deep Dive

### `streams.Result` Union (`streams.zig`)

This union is the lifeblood of the native stream system. It represents all possible outcomes of a single read operation and is key to many optimizations.

```zig
// from streams.zig
pub const Result = union(Tag) {
    pending: *Pending,              // Async operation pending, returns a Promise
    err: StreamError,               // Error occurred
    done: void,                     // Stream completed without a final chunk
    owned: bun.ByteList,            // Sink now owns this buffer and must free it
    owned_and_done: bun.ByteList,   // Owned buffer, this is the final chunk
    temporary_and_done: bun.ByteList, // Borrowed buffer (zero-copy), final chunk
    temporary: bun.ByteList,        // Borrowed buffer (zero-copy view)
    into_array: IntoArray,          // Data written directly to a JS-provided array (BYOB)
    into_array_and_done: IntoArray, // As above, but this is the final chunk
};
```

The `_and_done` variants are a crucial optimization, bundling the last chunk of data with the stream-close signal, saving an entire I/O round trip.

### Sink Implementations

#### `HTTPServerWritable` (`streams.zig`)

A highly optimized sink for HTTP responses.

- **Backpressure Handling**: If `res.write()` returns `backpressure`, the sink sets `this.has_backpressure = true` and registers an `onWritable` callback with `uWebSockets`. It will not signal readiness to the source until `onWritable` is called and the internal buffer is drained.
- **Auto-Flushing (`onAutoFlush`)**: When data is written to the buffer but the high-water mark isn't reached, a microtask is queued. The `onAutoFlush` function runs at the end of the event loop tick. If the socket is not under backpressure, it sends the buffered data. This ensures low latency for streaming APIs while still allowing multiple small writes within a single tick to be batched into one syscall.

#### `ArrayBufferSink` (`streams.zig`)

A simple sink that accumulates all incoming stream data into a single `bun.ByteList`. Used internally for `response.arrayBuffer()`.

### Tee Implementation (`ReadableStreamInternals.ts`)

Bun's `tee` implementation is spec-compliant and uses a state-machine approach.

```javascript
const enum TeeStateFlags {
    canceled1 = 1 << 0,
    canceled2 = 1 << 1,
    reading = 1 << 2,
    closedOrErrored = 1 << 3,
    readAgain = 1 << 4,
}

function readableStreamTee(stream, shouldClone) {
    const reader = new ReadableStreamDefaultReader(stream);
    const teeState = { /* ... holds state flags, reasons, and references to the branches ... */ };

    // The two new streams share a single pull function.
    const pullFunction = $readableStreamTeePullFunction(teeState, reader, shouldClone);

    const branch1 = new ReadableStream({ $pull: pullFunction, $cancel: /*...*/ });
    const branch2 = new ReadableStream({ $pull: pullFunction, $cancel: /*...*/ });

    // Forward errors/closure from the original stream's reader
    reader.closed.then(undefined, (e) => { /* error both branches */ });

    return [branch1, branch2];
}
```

The `pullFunction` reads from the original stream once, and then enqueues the chunk (or a clone of it) to both branches. It uses the `TeeStateFlags` to manage the state of both branches, including whether they've been cancelled or if a pull is already in progress.

## Data Flow Patterns

### 1. HTTP Response Streaming (Fast Path)

```
Client Request → Bun Server → fetch handler returns new Response(Bun.file("...").stream())
    ↓
Native code recognizes Response body is a File-tagged ReadableStream.
The sink is a native HTTPSResponseSink.
    ↓
Direct Path: `FileReader` is piped directly to `HTTPSResponseSink` in Zig.
    ↓
Data flows from disk -> file buffer -> socket buffer, entirely in native code.
JS is not involved in the per-chunk data transfer.
```

### 2. Body Mixin (`.text()`, `.json()`)

```
JS calls `response.text()`
    ↓
`tryUseReadableStreamBufferedFastPath` is called.
    ↓
Native code checks if `Body.Value` is already a complete buffer (e.g., .InternalBlob, .WTFStringImpl).
    ↓
IF YES:
    1. Returns a fulfilled promise with the complete buffer.
    2. The JS wrapper then decodes/parses it.
    3. The entire operation is synchronous or a single promise tick.
    ↓
IF NO (Body is a stream):
    1. The `Body.Value` state becomes `.Locked`, with `action: .getText`.
    2. A native `Body.ValueBufferer` is created.
    3. The stream is piped to the bufferer in native code.
    4. When the stream ends, the bufferer resolves the original promise with the full text.
```

## Memory Management

### Buffer Pooling (`HTTPServerWritable`)

To reduce GC pressure in the HTTP server, response write buffers are pooled.

```zig
// from streams.zig
if (comptime FeatureFlags.http_buffer_pooling) {
    if (WebCore.ByteListPool.getIfExists()) |pooled_node| {
        this.pooled_buffer = pooled_node;
        this.buffer = this.pooled_buffer.?.data; // Reuse buffer
    }
}
// On finalize, the buffer is returned to the pool
if (this.pooled_buffer) |pooled| {
    // ...
    pooled.release();
}
```

### Reference Counting

Core objects like `Response` and `FileSink` are reference-counted in Zig, ensuring they are not destroyed while still in use by JS or other native operations.

### String Optimization (`Body.Value.WTFStringImpl`)

When a `Response` is created with a JavaScript string, Bun stores it as a `bun.WTF.StringImpl` pointer. This avoids an immediate copy. If the string is later needed as bytes (e.g., for an HTTP response), `toBlobIfPossible` is called, which performs the UTF-8 conversion only when necessary.

## Performance Optimizations

1.  **Native Fast Paths**: The tagging system is the primary optimization, enabling direct native-to-native data flow.
2.  **`readMany()`**: The custom `readMany()` method on `ReadableStreamDefaultReader` allows the async iterator to drain the entire internal buffer in one call, drastically reducing the number of `await`s and context switches.
3.  **Synchronous Coercion**: The `tryUseReadableStreamBufferedFastPath` allows methods like `.text()` to complete synchronously if the data is already available, avoiding stream and promise allocation entirely.
4.  **Lazy Stream Creation**: Streams from native sources (`Bun.file`, `fetch` response) are not fully initialized until a reader is attached (`.getReader()` is called). The `start` property on the JS `ReadableStream` object points to a function that performs this late initialization.
5.  **`owned` vs `temporary` `Result`**: The native stream `Result` type distinguishes between buffers that need to be freed by the receiver (`owned`) and buffers that are temporary views (`temporary`), enabling zero-copy reads in many cases.

## Integration Patterns

### `Body` Mixin Integration

The `Body` mixin methods are the primary user-facing entry points that trigger all the underlying stream logic. They abstract away the complexity of whether the data is a static buffer or a live stream.

```javascript
// from ReadableStream.ts
export function readableStreamToArrayBuffer(stream: ReadableStream<ArrayBuffer>): Promise<ArrayBuffer> | ArrayBuffer {
  // 1. Check for native direct stream
  var underlyingSource = $getByIdDirectPrivate(stream, "underlyingSource");
  if (underlyingSource !== undefined) {
    return $readableStreamToArrayBufferDirect(stream, underlyingSource, false);
  }
  // 2. Check for locked stream (error)
  if ($isReadableStreamLocked(stream)) return Promise.$reject(...);

  // 3. Attempt synchronous fast path for buffered data
  let result = $tryUseReadableStreamBufferedFastPath(stream, "arrayBuffer");
  if (result) {
    return result;
  }

  // 4. Fallback to generic JS-based streaming and collection
  result = Bun.readableStreamToArray(stream);
  // ... process array of chunks
}
```

## Implementation Examples

### Creating a Direct Stream from an Async Iterator

Bun provides a seamless bridge from any async iterator to a high-performance direct stream.

```javascript
// from ReadableStreamInternals.ts
export function readableStreamFromAsyncIterator(target, fn) {
  var iter = fn.$call(target);
  // ...
  return new ReadableStream({
    type: "direct",
    async pull(controller) {
      // ...
      const { value, done } = await iter.next();
      if (done) {
        controller.end();
        return;
      }
      controller.write(value);
      // ...
    },
    // ...
  });
}
```

### HTTP Response with Streaming

```javascript
// This will use the "Default Stream" path.
// The JS function will be called to enqueue chunks.
return new Response(
  new ReadableStream({
    async start(controller) {
      controller.enqueue("Hello ");
      await Bun.sleep(100);
      controller.enqueue("World!");
      controller.close();
    },
  }),
);
```

### File-to-Socket Streaming (Fast Path)

```javascript
// This will use the "Direct Stream" path.
// The file's contents will be streamed directly to the network socket
// in native code, with no per-chunk JS overhead.
return new Response(Bun.file("./large-video.mp4").stream());
```
