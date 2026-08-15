// The per-thread setup node runs ahead of a worker's own code (lib/internal/main/worker_thread.js).
// Native code requires this module in every node:worker_threads worker before its preloads and entry
// point; node:worker_threads requires it too (on any thread) for the binding and what was set up here.
// It must stay cheap: nothing here loads streams, console or path — those come in on first use.

const binding = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as unknown[];
const rawWorkerData = binding[0] as any;
const threadId = binding[1] as number;
const setEntryEvaluatedHook = binding[9] as (hook: () => void) => void;
const isNodeWorker = binding[10] as boolean;
const setParentPort = binding[11] as (port: MessagePort) => void;
const workerStdioWrite = binding[13] as (fd: number, chunk: Uint8Array | null) => void;
const setStdioAckHandler = binding[14] as (handler: (fd: number, consoleChunk?: Uint8Array) => void) => void;
const refEventLoop = binding[16] as (delta: 1 | -1) => void;
const setStdioDiverted = binding[17] as (fd: number, diverted: boolean) => void;

// The parent's Worker constructor wraps workerData to smuggle these across (ports ride transferred).
const BUN_WORKER_STDIO_KEY = "@@bunWorkerThreadsStdio";
const BUN_WORKER_MESSAGING_KEY = "@@bunWorkerThreadsMessaging";
const BUN_WORKER_PARENT_PORT_KEY = "@@bunWorkerThreadsParentPort";

let workerData = rawWorkerData; // still packed (transferred FileHandles etc.); node:worker_threads unpacks it
let parentPort: MessagePort | null = null;
let stdinPort: MessagePort | undefined;
let hasOwnProcessStdio = false;

if (
  !Bun.isMainThread &&
  isNodeWorker &&
  rawWorkerData &&
  typeof rawWorkerData === "object" &&
  (BUN_WORKER_MESSAGING_KEY in rawWorkerData ||
    BUN_WORKER_PARENT_PORT_KEY in rawWorkerData ||
    BUN_WORKER_STDIO_KEY in rawWorkerData)
) {
  const controlPort = rawWorkerData[BUN_WORKER_MESSAGING_KEY];
  parentPort = rawWorkerData[BUN_WORKER_PARENT_PORT_KEY] ?? null;
  stdinPort = rawWorkerData[BUN_WORKER_STDIO_KEY]?.stdin;
  workerData = rawWorkerData.data;

  const messaging = require("internal/worker/messaging");
  messaging.initThreadInfo(threadId, false);
  if (controlPort) messaging.setupMainThreadPort(controlPort, setEntryEvaluatedHook);
  if (parentPort) {
    // node auto-starts parentPort, but delivery waits until the entry module has evaluated
    // (registering it natively is how start() knows to defer). It arrives without a loop ref, so an
    // unlistened parentPort does not by itself keep the thread alive (a 'message' listener refs it).
    setParentPort(parentPort);
    parentPort.start();
  }
  hasOwnProcessStdio = true;
}

// node gives a worker its own process.stdout / stderr / stdin: writes reach the parent (worker.stdout /
// worker.stderr, else the parent's own stdio) in order with console output, which travels the same
// native path; stdin is fed by worker.stdin when the parent asked for { stdin: true } and is otherwise
// already ended — never the process-wide fd 0, which would race the main thread. process builds its
// stdio lazily (ProcessObjectInternals) and asks here first.
function workerProcessStdio(fd: number) {
  if (!hasOwnProcessStdio) return undefined;
  return fd === 0 ? makeStdin() : makeParentWritable(fd);
}

// process.stdout / process.stderr in the worker, with node's flow control (lib/internal/worker/io.js): the
// bytes leave right away, but a write's callback is held until the parent says it has taken them — from
// worker.stdout's _read() when the parent captures or reads it, straight after writing them out otherwise
// — so write() returns false and 'drain' waits while the parent is not keeping up. One batch is
// outstanding at a time and the thread stays alive while it is. end() ends worker.stdout on the parent.
const parentWritables: any[] = [];
function makeParentWritable(fd: number) {
  const Writable = require("internal/streams/writable");
  let pendingWriteCallback: ((error?: Error | null) => void) | null = null;
  // While a write is outstanding, later writes queue in the stream; console output is then sent through the
  // stream as well (setStdioDiverted) so it cannot overtake them.
  function completeWrite(err?: Error | null) {
    const cb = pendingWriteCallback;
    if (cb !== null) {
      pendingWriteCallback = null;
      setStdioDiverted(fd, false);
      refEventLoop(-1);
      cb(err); // may write what queued meanwhile, diverting again
    }
  }
  function awaitAck(cb: (error?: Error | null) => void) {
    if (process._exiting) {
      // No event loop turns remain for the ack to arrive in; the bytes are already with the parent.
      cb();
    } else {
      pendingWriteCallback = cb;
      setStdioDiverted(fd, true);
      refEventLoop(1);
    }
  }
  const stream = new Writable({
    decodeStrings: false,
    write(chunk, encoding, cb) {
      workerStdioWrite(fd, typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk);
      awaitAck(cb);
    },
    writev(chunks, cb) {
      for (let i = 0; i < chunks.length; i++) {
        const { chunk, encoding } = chunks[i];
        workerStdioWrite(fd, typeof chunk === "string" ? Buffer.from(chunk, encoding) : chunk);
      }
      awaitAck(cb);
    },
    final(cb) {
      workerStdioWrite(fd, null);
      cb();
    },
    destroy(err, cb) {
      completeWrite(err);
      cb(err);
    },
  });
  stream.fd = fd;
  stream._type = "pipe";
  stream._isStdio = true;
  stream.destroySoon = stream.destroy;
  stream.onParentAck = completeWrite;
  if (parentWritables.length === 0) {
    setStdioAckHandler((fd, consoleChunk) => {
      const stream = parentWritables[fd];
      if (consoleChunk === undefined) stream?.onParentAck();
      else stream.write(consoleChunk);
    });
    // A synchronous exit leaves no loop turns for an ack: releasing the outstanding write then lets each
    // stream push what it had queued behind it through writev, which completes at once now (node's flushSync).
    process.on("exit", () => {
      parentWritables[1]?.onParentAck();
      parentWritables[2]?.onParentAck();
    });
  }
  parentWritables[fd] = stream;
  return stream;
}

function makeStdin() {
  if (stdinPort) return makePortReadable(stdinPort, true);
  const Readable = require("internal/streams/readable");
  const stream = new Readable({
    read() {
      this.push(null);
    },
  });
  stream.fd = 0;
  return stream;
}

// Readable fed by a control MessagePort (process.stdin in the worker, from worker.stdin on the parent),
// with node's flow control (lib/internal/worker/io.js): the writer posts an array of chunks and
// withholds its writev callback until the reader acks from _read(); null is EOF.
function makePortReadable(port: MessagePort, incrementsPortRef: boolean) {
  const Readable = require("internal/streams/readable");
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
  const stream = new Readable({
    read() {
      if (startedReading === false && incrementsPortRef) {
        startedReading = true;
        port.ref();
      }
      // Tell the writer we want more data; it completes its in-flight writev on receipt.
      if (ended === false) port.postMessage(true);
    },
  });
  // Attach eagerly so the peer's writev is ack'd (via push -> maybeReadMore -> _read) even when no one
  // consumes this stream; unref immediately so an unconsumed stream never pins the loop on its own.
  port.addEventListener("message", onMessage);
  port.start();
  port.unref();
  // 'close' covers natural EOF and destroy(); release the read-time ref and drop the listener so a
  // destroyed stream can't pin an unref'd worker.
  stream.on("close", () => {
    ended = true;
    port.removeEventListener("message", onMessage);
    if (startedReading && incrementsPortRef) {
      startedReading = false;
      port.unref();
    }
  });
  stream.fd = 0;
  return stream;
}

export default {
  binding,
  workerData,
  parentPort,
  workerProcessStdio,
  BUN_WORKER_STDIO_KEY,
  BUN_WORKER_MESSAGING_KEY,
  BUN_WORKER_PARENT_PORT_KEY,
};
