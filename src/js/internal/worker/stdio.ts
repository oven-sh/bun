// The stdio streams of a node:worker_threads Worker, on both of its ends: worker.stdin,
// worker.stdout and worker.stderr in the parent, and process.stdin, process.stdout and
// process.stderr in the worker (built lazily from BunProcess.cpp via ProcessObjectInternals).
//
// The three streams of a worker share one MessageChannel, as they share node's internal port:
// what a worker writes to stdout and to stderr reaches the parent in the order of the writes.
// Flow control is node's (lib/internal/worker/io.js): the writer posts a batch of chunks and
// withholds the writev callback until the reader asks for more data from _read(). One batch of
// a stream is in flight at a time; further writes buffer in the Writable, so write() returns
// false and 'drain' fires only when the consumer catches up.
//
// A batch is [fd, ...chunks], where a null chunk is the end of the stream. A request for more
// data is the bare fd.

const kFlushSync = Symbol("kFlushSync");

interface PortWritable extends $Node.Writable {
  [kFlushSync]: () => void;
}

type Batch = [fd: number, ...chunks: (Uint8Array | null)[]];
type Message = number | Batch;

function makeStdioChannel(port: MessagePort, receiveMessageOnPort?: (port: unknown) => unknown) {
  // By fd: what takes the batches of a stream that is read here, what takes a request for
  // more of a stream that is written here, and what ends a stream that is read here.
  const readers: (((batch: Batch) => void) | undefined)[] = [undefined, undefined, undefined];
  const writers: ((() => void) | undefined)[] = [undefined, undefined, undefined];
  const enders: ((() => void) | undefined)[] = [undefined, undefined, undefined];

  // node's kWaitingStreams: the port keeps its thread alive only while a stream waits for the
  // other end, a writer for the request that completes its batch, a captured reader for data.
  let waiting = 0;
  function ref() {
    if (waiting++ === 0) port.ref();
  }
  function unref() {
    if (--waiting === 0) port.unref();
  }

  function dispatch(message: Message) {
    if (typeof message === "number") writers[message]?.();
    else readers[message[0]]?.(message);
  }
  // Listen from the start, so that the other end's writev is answered (push -> maybeReadMore ->
  // _read) even when nothing consumes a stream here. The listener alone never keeps the thread
  // alive.
  port.addEventListener("message", (event: { data: Message }) => dispatch(event.data));
  port.unref();

  // What the port holds now, ahead of its own turn of the event loop. For the parent, which has
  // receiveMessageOnPort().
  function readPending() {
    let entry: unknown;
    while ((entry = receiveMessageOnPort!(port)) !== undefined) dispatch((entry as { message: Message }).message);
  }

  function endFrom(fd: number) {
    if (fd === enders.length) return;
    try {
      enders[fd]?.();
    } finally {
      endFrom(fd + 1);
    }
  }

  return {
    // worker.stdout and worker.stderr in the parent, process.stdin in the worker.
    readable(fd: number, incrementsPortRef: boolean): $Node.Readable {
      const Readable = require("internal/streams/readable");
      let ended = false;
      let startedReading = false;
      const stream: $Node.Readable = new Readable({
        read() {
          if (startedReading === false && incrementsPortRef) {
            startedReading = true;
            ref();
          }
          // Tell the writer we want more data; it completes its in-flight writev
          // on receipt (node's STDIO_WANTS_MORE_DATA).
          if (ended === false) port.postMessage(fd);
        },
      });
      readers[fd] = batch => {
        for (let i = 1; i < batch.length && ended === false; i++) {
          const chunk = batch[i];
          if (chunk === null) {
            ended = true;
            stream.push(null);
          } else {
            stream.push(Buffer.from(chunk));
          }
        }
      };
      enders[fd] = () => {
        if (ended === false) {
          ended = true;
          stream.push(null);
        }
      };
      // 'close' covers natural EOF and destroy(): a captured stream that was read no longer
      // keeps the thread alive.
      stream.on("close", () => {
        ended = true;
        if (startedReading && incrementsPortRef) {
          startedReading = false;
          unref();
        }
      });
      return stream;
    },

    // worker.stdin in the parent, process.stdout and process.stderr in the worker.
    writable(fd: number): PortWritable {
      const Writable = require("internal/streams/writable");
      let pendingWriteCallback: $Node.ErrorCallback | null = null;
      // A request that finds no batch in flight is dropped, as in node.
      function onRequest() {
        const cb = pendingWriteCallback;
        if (cb !== null) {
          pendingWriteCallback = null;
          unref();
          cb();
        }
      }
      writers[fd] = onRequest;
      const stream = new Writable({
        decodeStrings: false,
        writev(chunks: $Node.ChunkToWrite[], cb: $Node.ErrorCallback) {
          const batch = new Array(chunks.length + 1);
          batch[0] = fd;
          for (let i = 0; i < chunks.length; i++) {
            const { chunk, encoding } = chunks[i];
            batch[i + 1] = typeof chunk === "string" ? Buffer.from(chunk, encoding as BufferEncoding) : chunk;
          }
          port.postMessage(batch);
          if (process._exiting) {
            // No event loop turns remain to deliver a request; complete synchronously
            // so exit-time writes are not lost (node does the same).
            cb();
          } else {
            // Only one writev is in flight at a time, so the slot can't be occupied.
            pendingWriteCallback = cb;
            ref();
          }
        },
        final(cb: $Node.ErrorCallback) {
          port.postMessage([fd, null]);
          cb();
        },
        destroy(err: Error | null, cb: $Node.ErrorCallback) {
          // The reader may never ask a destroyed stream for more: release the batch in flight
          // and take no later request.
          const pending = pendingWriteCallback;
          if (pending !== null) {
            pendingWriteCallback = null;
            unref();
            pending(err);
          }
          writers[fd] = undefined;
          cb(err);
        },
      }) as PortWritable;
      // On a synchronous exit no request can arrive; completing the parked writev lets
      // the Writable clear its buffer through writev, which now completes
      // synchronously because process._exiting is set (node's flushSync).
      stream[kFlushSync] = onRequest;
      return stream;
    },

    readPending,

    // The worker has exited. What it wrote and the port still holds comes first (node's kOnExit
    // drains its port), then every stream that is read here ends.
    endFromOwner() {
      try {
        readPending();
      } finally {
        endFrom(0);
      }
    },
  };
}

// The channel of this thread's own process.stdin, process.stdout and process.stderr.
let ownChannel: ReturnType<typeof makeStdioChannel> | undefined;
function ownStdioChannel(port: MessagePort) {
  return (ownChannel ??= makeStdioChannel(port));
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
  makeStdioChannel,
  ownStdioChannel,
  makeEndedReadable,
} as const;
