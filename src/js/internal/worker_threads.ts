const { Readable, Writable } = require("node:stream");

const {
  0: _workerData,
  1: _threadId,
  2: _receiveMessageOnPort,
  3: environmentData,
  4: pushStdioToParent,
  5: pushStdinToChild,
} = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as [
  unknown,
  number,
  (port: unknown) => unknown,
  Map<unknown, unknown>,
  (fd: number, data: Buffer) => void,
  (worker: globalThis.Worker, data: Buffer) => void,
];

// Class exposed as `process.stdout` and `process.stderr` in Worker threads, and `worker.stdin` in the parent thread
class WritableWorkerStdio extends Writable {
  #fd: number;
  // `undefined` for output streams in the worker thread
  // Worker instance for stdin stream in the parent thread
  #worker: Worker | undefined;

  constructor(fd: number, worker?: Worker) {
    super();
    $assert(worker === undefined || fd === 0);
    this.#fd = fd;
    this.#worker = worker;

    if (worker) {
      this.on("close", () => {
        // process.stdin.push(null) in worker
      });
    }
  }

  _write(chunk: unknown, encoding: string, callback: (error?: Error | null) => void): void {
    $assert(chunk instanceof Buffer);
    $assert(encoding === "buffer");
    if (this.#worker) {
      pushStdinToChild(this.#worker, chunk);
    } else {
      pushStdioToParent(this.#fd, chunk);
    }
    callback();
  }
}

// Class exposed as `worker.stdout` and `worker.stderr` in the parent thread, and `process.stdin` in the Worker thread
class ReadableWorkerStdio extends Readable {
  constructor(worker?: Worker) {
    super();
    if (worker) {
      worker.addEventListener("close", () => {
        this.push(null);
      });
    } else {
      // needs to push null when parent thread calls end() on stdin
    }
  }

  _read() {}
}

// Map to access stdio-related options from an internal Web Worker object (not a worker_threads Worker)
const webWorkerToStdio = new WeakMap<
  globalThis.Worker,
  {
    // stdout stream exposed in the parent thread
    stdout: ReadableWorkerStdio;
    // stderr stream exposed in the parent thread
    stderr: ReadableWorkerStdio;
  }
>();

export default {
  WritableWorkerStdio,
  ReadableWorkerStdio,
  _workerData,
  _threadId,
  _receiveMessageOnPort,
  environmentData,
  webWorkerToStdio,
};
