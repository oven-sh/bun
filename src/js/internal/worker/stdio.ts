// Port-backed stdio streams shared by both ends of a node:worker_threads Worker:
// worker.stdout/stderr/stdin on the parent, process.stdout/stderr/stdin in the
// worker (built on first read: NodeWorkerState::stdioStream via ProcessObjectInternals).
//
// Each stream rides its own MessageChannel with node's flow control
// (lib/internal/worker/io.js): the writer posts an array of chunks and withholds
// the writev callback until the reader acks from _read(). One batch is in
// flight at a time; further writes buffer in the Writable, so write() returns
// false and 'drain' fires only when the consumer catches up. The payload is the
// bare chunk array, EOF is null, and any other message is the ack.

type PortReadable = import("node:stream").Readable & { endFromOwner?(): void };

// Readable fed by a MessagePort (worker.stdout/stderr on the parent, process.stdin
// in the worker). The peer posts arrays of Buffers; null signals EOF.
function makePortReadable(port: MessagePort, incrementsPortRef: boolean) {
  return makeReadable(port, incrementsPortRef, undefined, true)[0];
}

// [the Readable, its 'message' listener]. `listens`: false when the caller puts that listener on the port.
function makeReadable(
  port: MessagePort,
  incrementsPortRef: boolean,
  highWaterMark: number | undefined,
  listens: boolean,
): [PortReadable, (event: { data: Uint8Array[] | null }) => void] {
  let ended = false;
  let startedReading = false;
  // The writer takes a request for more data for the ack of its batch in flight, so none goes out ahead of the first batch.
  let received = false;
  function onMessage(event: { data: Uint8Array[] | null }) {
    const payload = event.data;
    if (payload === null) {
      if (ended === false) {
        ended = true;
        stream.push(null);
      }
      port.removeEventListener("message", onMessage);
    } else if (ended === false) {
      received = true;
      for (let i = 0; i < payload.length; i++) {
        stream.push(Buffer.from(payload[i]));
      }
    }
  }
  const Readable = require("internal/streams/readable");
  const stream: PortReadable = new Readable({
    // A worker builds its streams after user code ran: the options are not taken from Object.prototype.
    __proto__: null,
    highWaterMark,
    read() {
      if (startedReading === false && incrementsPortRef) {
        startedReading = true;
        port.ref();
      }
      // Tell the writer we want more data; it completes its in-flight writev
      // on receipt (node's STDIO_WANTS_MORE_DATA).
      if (ended === false && received) port.postMessage(true);
    },
    // The build of a worker's stream calls no method that user code can replace. So that stream learns of its end here, and not from on("close").
    destroy: listens ? undefined : (error, callback) => (onClose(), callback(error)),
  });
  // Attach eagerly so the peer's writev is ack'd (via push -> maybeReadMore ->
  // _read) even when no one consumes this stream; unref immediately so an
  // unconsumed captured stream never pins the loop on its own (node's model).
  if (listens) {
    port.addEventListener("message", onMessage);
    port.unref();
  }
  // 'close' covers natural EOF and destroy(); release the read-time ref and
  // drop the listener so a destroyed captured stream can't pin an unref'd worker.
  if (listens) stream.on("close", onClose);
  function onClose() {
    ended = true;
    port.removeEventListener("message", onMessage);
    if (startedReading && incrementsPortRef) {
      startedReading = false;
      port.unref();
    }
  }
  // Lets the parent end worker.stdout/stderr when the worker exits abruptly.
  stream.endFromOwner = function () {
    if (ended === false) {
      ended = true;
      stream.push(null);
      port.removeEventListener("message", onMessage);
    }
  };
  return [stream, onMessage];
}

// Writable that forwards chunks over a MessagePort (worker.stdin on the parent,
// process.stdout/stderr in the worker). final() posts null as EOF.
function makePortWritable(port: MessagePort) {
  return makeWritable(port, undefined, false, true)[0];
}

// [the Writable, its 'message' listener: what completes its batch in flight, also without the reader's ack]. `consoleInFlight`: the worker's console posted a message over this port that the reader has yet to ack. `listens`: false when the caller puts that listener on the port.
function makeWritable(
  port: MessagePort,
  highWaterMark: number | undefined,
  consoleInFlight: boolean,
  listens: boolean,
): [import("node:stream").Writable, () => void] {
  const Writable = require("internal/streams/writable");
  // Reader-side acks complete the in-flight writev.
  let pendingWriteCallback: ((error?: Error | null) => void) | null = null;
  // The next ack is for the console's message. Until it comes, a writev or the end of the stream waits in `held`: one message is in flight at a time. The stream has the loop ref that the console took for its message.
  let waitsForConsole = consoleInFlight;
  // [the payload of a writev, or null for the end of the stream; its callback]
  let held: [Buffer[] | null, (error?: Error | null) => void] | null = null;
  function post(payload: Buffer[] | null, cb: (error?: Error | null) => void) {
    port.postMessage(payload);
    if (payload === null || process._exiting) {
      // Nothing acks the end of the stream. At an exit no event loop turns remain to deliver an ack, so a write completes at once and is not lost (node does the same).
      cb();
    } else {
      // Only one writev is in flight at a time, so the slot can't be occupied.
      pendingWriteCallback = cb;
      port.ref();
    }
  }
  function onAck() {
    if (waitsForConsole) {
      waitsForConsole = false;
      port.unref();
      const waiting = held;
      if (waiting !== null) {
        held = null;
        post(waiting[0], waiting[1]);
      }
      return;
    }
    const cb = pendingWriteCallback;
    if (cb !== null) {
      pendingWriteCallback = null;
      port.unref();
      cb();
    }
  }
  const stream = new Writable({
    __proto__: null,
    highWaterMark,
    decodeStrings: false,
    writev(chunks, cb) {
      const payload = new Array(chunks.length);
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, encoding } = chunks[i];
        payload[i] = typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk;
      }
      if (waitsForConsole) held = [payload, cb];
      else post(payload, cb);
    },
    final(cb) {
      if (waitsForConsole) held = [null, cb];
      else post(null, cb);
    },
    destroy(err, cb) {
      // Discharge an in-flight batch: the reader may never ack a destroyed
      // stream, so release the loop ref taken in writev and complete the
      // parked callback; drop the ack listener so a late ack can't fire
      // into the destroyed stream.
      if (waitsForConsole) {
        waitsForConsole = false;
        port.unref();
      }
      const waiting = held;
      if (waiting !== null) {
        held = null;
        // Not posted: that write, or that end, did not happen.
        waiting[1](err ?? $ERR_STREAM_DESTROYED(waiting[0] === null ? "end" : "write"));
      }
      const pending = pendingWriteCallback;
      if (pending !== null) {
        pendingWriteCallback = null;
        port.unref();
        pending(err);
      }
      port.removeEventListener("message", onAck);
      cb(err);
    },
  } as import("node:stream").WritableOptions);
  if (listens) {
    // Last: a constructor that threw must leave nothing on the port.
    port.addEventListener("message", onAck);
    // The listener refs the event loop. That is released while no batch is in flight: unflushed data keeps the writer alive (node's kWaitingStreams), and an idle stream never pins the loop.
    port.unref();
  }
  // On a synchronous exit no ack can arrive. onAck then lets the Writable clear its buffer through writev, which completes synchronously because process._exiting is set (node's flushSync).
  return [stream, onAck];
}

// How the console of a worker writes to its process.stdout / stderr once that exists: as the Console of node:console writes to a stream.
function makeConsoleWriter(stream: import("node:stream").Writable) {
  const { write, ignoreWriteError } = require("internal/console_write");
  function onWritten(err?: Error | null) {
    ignoreWriteError(stream, err);
  }
  return function (text: string) {
    write(stream, text, onWritten);
  };
}

// A node worker's process.stdin without { stdin: true }.
function makeEndedReadable(highWaterMark: number) {
  const Readable = require("internal/streams/readable");
  return new Readable({
    __proto__: null,
    highWaterMark,
    read() {
      this.push(null);
    },
  });
}

// process.stdin (0), stdout (1) or stderr (2) of a worker: [the stream, its 'message' listener for the port, what the console writes to stdout or stderr with]. The caller (NodeWorkerState::stdioStream) puts the listener on the port. So the build calls no method of the port or of the stream: once the constructor returned, nothing that user code can replace runs here. node builds the streams before the worker's entry point. Built on first use here, they still get the two construction-time defaults of a stream as they were at worker start.
function makeWorkerProcessStream(fd: number, port: MessagePort | undefined, consoleInFlight: boolean) {
  const EventEmitter = require("node:events");
  const highWaterMark = require("internal/streams/state").initialHighWaterMarkBytes;
  const captureRejections = EventEmitter.captureRejections;
  if (captureRejections) EventEmitter.captureRejections = false;
  try {
    if (fd === 0) {
      if (!port) return [makeEndedReadable(highWaterMark), undefined, undefined];
      const built = makeReadable(port, true, highWaterMark, false);
      return [built[0], built[1], undefined];
    }
    const built = makeWritable(port!, highWaterMark, consoleInFlight, false);
    return [built[0], built[1], makeConsoleWriter(built[0])];
  } finally {
    if (captureRejections) EventEmitter.captureRejections = true;
  }
}

export default {
  makePortReadable,
  makePortWritable,
  makeWorkerProcessStream,
};
