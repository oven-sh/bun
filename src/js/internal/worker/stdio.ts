// Port-backed stdio streams shared by both ends of a node:worker_threads Worker:
// worker.stdout/stderr/stdin on the parent, process.stdout/stderr/stdin in the
// worker (built lazily from BunProcess.cpp via ProcessObjectInternals).
//
// The three streams of a worker share one MessageChannel, as they share the one
// internal port of a node worker (lib/internal/worker/io.js): what a thread posts
// for any of them arrives in the order it was posted. Every stream listens to the
// port and takes the messages of its fd. Flow control is node's, and is per
// stream: the writer posts an array of chunks and withholds the writev callback
// until the reader acks from _read(). One batch is in flight at a time; further
// writes buffer in the Writable, so write() returns false and 'drain' fires only
// when the consumer catches up. A batch is its chunks followed by the fd, the ack
// is the bare fd, and EOF is -1 - fd.

const kFlushSync = Symbol("kFlushSync");

// One end of the channel. `waiting` counts the streams that keep the port ref'd
// (node's kWaitingStreams): a listener alone must not.
interface StdioChannel {
  port: MessagePort;
  waiting: number;
}

interface PortReadable extends $Node.Readable {
  deliverFromOwner?(message: unknown): void;
  endFromOwner?(): void;
}

interface PortWritable extends $Node.Writable {
  [kFlushSync]: () => void;
}

// Readable fed by the channel (worker.stdout/stderr on the parent, process.stdin
// in the worker). The peer posts arrays of Buffers, and EOF.
function makePortReadable(channel: StdioChannel, fd: number, incrementsPortRef: boolean) {
  const port = channel.port;
  let ended = false;
  let startedReading = false;
  function onMessage(event: { data: unknown }) {
    const payload = event.data as unknown[] | number;
    if (typeof payload === "number") {
      // Any other number is an ack, or the EOF of another stream.
      if (payload !== -1 - fd) return;
      if (ended === false) {
        ended = true;
        stream.push(null);
      }
      port.removeEventListener("message", onMessage);
      return;
    }
    const last = payload.length - 1;
    if (payload[last] !== fd || ended) return;
    for (let i = 0; i < last; i++) {
      stream.push(Buffer.from(payload[i] as Uint8Array));
    }
  }
  const Readable = require("internal/streams/readable");
  const stream: PortReadable = new Readable({
    read() {
      if (startedReading === false && incrementsPortRef) {
        startedReading = true;
        if (channel.waiting++ === 0) port.ref();
      }
      // Tell the writer we want more data; it completes its in-flight writev
      // on receipt (node's STDIO_WANTS_MORE_DATA).
      if (ended === false) port.postMessage(fd);
    },
  });
  // Attach eagerly so the peer's writev is ack'd (via push -> maybeReadMore ->
  // _read) even when no one consumes this stream; the listener takes no ref, so an
  // unconsumed captured stream never pins the loop on its own (node's model).
  port.addEventListener("message", onMessage);
  if (channel.waiting === 0) port.unref();
  // 'close' covers natural EOF and destroy(); release the read-time ref and
  // drop the listener so a destroyed captured stream can't pin an unref'd worker.
  stream.on("close", () => {
    ended = true;
    port.removeEventListener("message", onMessage);
    if (startedReading && incrementsPortRef) {
      startedReading = false;
      if (--channel.waiting === 0) port.unref();
    }
  });
  // When the worker exits, the parent hands over what the worker wrote and the port
  // still holds (node's kOnExit drains its port), then ends worker.stdout/stderr.
  stream.deliverFromOwner = function (message) {
    onMessage({ data: message });
  };
  stream.endFromOwner = function () {
    if (ended === false) {
      ended = true;
      stream.push(null);
      port.removeEventListener("message", onMessage);
    }
  };
  return stream;
}

// Writable that forwards chunks over the channel (worker.stdin on the parent,
// process.stdout/stderr in the worker). final() posts EOF.
function makePortWritable(channel: StdioChannel, fd: number) {
  const port = channel.port;
  const Writable = require("internal/streams/writable");
  // Reader-side acks complete the in-flight writev. The listener takes no ref:
  // the port is ref'd only while a batch is awaiting its ack, so unflushed data
  // keeps the writer alive (node's kWaitingStreams) but an idle stream never
  // pins the loop.
  let pendingWriteCallback: $Node.ErrorCallback | null = null;
  // Also the 'exit' listener (kFlushSync), which is given the exit code and not an event.
  function onAck(event: unknown) {
    if (typeof event === "object" && (event as { data: unknown }).data !== fd) return;
    const cb = pendingWriteCallback;
    if (cb !== null) {
      pendingWriteCallback = null;
      if (--channel.waiting === 0) port.unref();
      cb();
    }
  }
  port.addEventListener("message", onAck);
  if (channel.waiting === 0) port.unref();
  const stream = new Writable({
    decodeStrings: false,
    writev(chunks: $Node.ChunkToWrite[], cb: $Node.ErrorCallback) {
      const payload = new Array(chunks.length + 1);
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, encoding } = chunks[i];
        payload[i] = typeof chunk === "string" ? Buffer.from(chunk, encoding as BufferEncoding) : chunk;
      }
      payload[chunks.length] = fd;
      port.postMessage(payload);
      if (process._exiting) {
        // No event loop turns remain to deliver an ack; complete synchronously
        // so exit-time writes are not lost (node does the same).
        cb();
      } else {
        // Only one writev is in flight at a time, so the slot can't be occupied.
        pendingWriteCallback = cb;
        if (channel.waiting++ === 0) port.ref();
      }
    },
    final(cb: $Node.ErrorCallback) {
      port.postMessage(-1 - fd);
      cb();
    },
    destroy(err: Error | null, cb: $Node.ErrorCallback) {
      // Discharge an in-flight batch: the reader may never ack a destroyed
      // stream, so release the loop ref taken in writev and complete the
      // parked callback; drop the ack listener so a late ack can't fire
      // into the destroyed stream.
      const pending = pendingWriteCallback;
      if (pending !== null) {
        pendingWriteCallback = null;
        if (--channel.waiting === 0) port.unref();
        pending(err);
      }
      port.removeEventListener("message", onAck);
      cb(err);
    },
  }) as PortWritable;
  // On a synchronous exit no ack can arrive; completing the parked writev lets
  // the Writable clear its buffer through writev, which now completes
  // synchronously because process._exiting is set (node's flushSync).
  stream[kFlushSync] = onAck;
  return stream;
}

// A node worker's process.stdin without { stdin: true }.
function makeEndedReadable() {
  const Readable = require("internal/streams/readable");
  return new Readable({
    read(this: $Node.Readable) {
      this.push(null);
    },
  });
}

export default {
  kFlushSync,
  makePortReadable,
  makePortWritable,
  makeEndedReadable,
} as const;
