// Port-backed stdio streams shared by both ends of a node:worker_threads Worker:
// worker.stdout/stderr/stdin on the parent, process.stdout/stderr/stdin in the
// worker (built lazily from BunProcess.cpp via ProcessObjectInternals).
//
// Each stream rides its own MessageChannel with node's flow control
// (lib/internal/worker/io.js): the writer posts an array of chunks and withholds
// the writev callback until the reader acks from _read(). One batch is in
// flight at a time; further writes buffer in the Writable, so write() returns
// false and 'drain' fires only when the consumer catches up. The payload is the
// bare chunk array, EOF is null, and any other message is the ack.

const kFlushSync = Symbol("kFlushSync");

// Readable fed by a MessagePort (worker.stdout/stderr on the parent, process.stdin
// in the worker). The peer posts arrays of Buffers; null signals EOF.
function makePortReadable(port: MessagePort, incrementsPortRef: boolean) {
  let ended = false;
  let startedReading = false;
  function onMessage(event: MessageEvent) {
    const payload = event.data;
    if (payload === null) {
      if (ended === false) {
        ended = true;
        stream.push(null);
      }
      port.removeEventListener("message", onMessage);
    } else if (ended === false) {
      for (let i = 0; i < payload.length; i++) {
        stream.push(Buffer.from(payload[i]));
      }
    }
  }
  const Readable = require("internal/streams/readable");
  const stream = new Readable({
    read() {
      if (startedReading === false && incrementsPortRef) {
        startedReading = true;
        port.ref();
      }
      // Tell the writer we want more data; it completes its in-flight writev
      // on receipt (node's STDIO_WANTS_MORE_DATA).
      if (ended === false) port.postMessage(true);
    },
  });
  // Attach eagerly so the peer's writev is ack'd (via push -> maybeReadMore ->
  // _read) even when no one consumes this stream; unref immediately so an
  // unconsumed captured stream never pins the loop on its own (node's model).
  port.addEventListener("message", onMessage);
  port.unref();
  // 'close' covers natural EOF and destroy(); release the read-time ref and
  // drop the listener so a destroyed captured stream can't pin an unref'd worker.
  stream.on("close", () => {
    ended = true;
    port.removeEventListener("message", onMessage);
    if (startedReading && incrementsPortRef) {
      startedReading = false;
      port.unref();
    }
  });
  // Lets the parent end worker.stdout/stderr when the worker exits abruptly.
  stream.endFromOwner = function () {
    if (ended === false) {
      ended = true;
      stream.push(null);
      port.removeEventListener("message", onMessage);
    }
  };
  return stream;
}

// Writable that forwards chunks over a MessagePort (worker.stdin on the parent,
// process.stdout/stderr in the worker). final() posts null as EOF.
function makePortWritable(port: MessagePort) {
  const Writable = require("internal/streams/writable");
  // Reader-side acks complete the in-flight writev. The listener refs the
  // event loop; release that immediately — the port is re-ref'd only while a
  // batch is awaiting its ack, so unflushed data keeps the writer alive
  // (node's kWaitingStreams) but an idle stream never pins the loop.
  let pendingWriteCallback: ((error?: Error | null) => void) | null = null;
  function onAck() {
    const cb = pendingWriteCallback;
    if (cb !== null) {
      pendingWriteCallback = null;
      port.unref();
      cb();
    }
  }
  port.addEventListener("message", onAck);
  port.unref();
  const stream = new Writable({
    decodeStrings: false,
    writev(chunks, cb) {
      const payload = new Array(chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, encoding } = chunks[i];
        payload[i] = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
      }
      port.postMessage(payload);
      if (process._exiting) {
        // No event loop turns remain to deliver an ack; complete synchronously
        // so exit-time writes are not lost (node does the same).
        cb();
      } else {
        // Only one writev is in flight at a time, so the slot can't be occupied.
        pendingWriteCallback = cb;
        port.ref();
      }
    },
    final(cb) {
      port.postMessage(null);
      cb();
    },
    destroy(err, cb) {
      // Discharge an in-flight batch: the reader may never ack a destroyed
      // stream, so release the loop ref taken in writev and complete the
      // parked callback; drop the ack listener so a late ack can't fire
      // into the destroyed stream.
      const pending = pendingWriteCallback;
      if (pending !== null) {
        pendingWriteCallback = null;
        port.unref();
        pending(err);
      }
      port.removeEventListener("message", onAck);
      cb(err);
    },
  });
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
    read() {
      this.push(null);
    },
  });
}

export default {
  kFlushSync,
  makePortReadable,
  makePortWritable,
  makeEndedReadable,
};
