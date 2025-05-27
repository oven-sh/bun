const { Readable, Writable } = require("node:stream");

const {
  0: _workerData,
  1: _threadId,
  2: _receiveMessageOnPort,
  3: environmentData,
  4: pushStdioToParent,
} = $cpp("Worker.cpp", "createNodeWorkerThreadsBinding") as [
  unknown,
  number,
  (port: unknown) => unknown,
  Map<unknown, unknown>,
  (fd: number, data: Buffer) => void,
];

// Class exposed as `process.stdout` and `process.stderr` in Worker threads
class WritableWorkerStdio extends Writable {
  #fd: number;

  constructor(fd: number) {
    super();
    this.#fd = fd;
  }

  _write(chunk: unknown, encoding: string, callback: (error?: Error | null) => void): void {
    $assert(chunk instanceof Buffer);
    $assert(encoding === "buffer");
    pushStdioToParent(this.#fd, chunk);
    callback();
  }
}

// Class exposed as `worker.stdout` and `worker.stderr` in the parent thread
class ReadableWorkerStdio extends Readable {
  constructor(worker: globalThis.Worker) {
    super();
    worker.addEventListener("close", () => {
      this.push(null);
    });
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
  pushStdioToParent,
  webWorkerToStdio,
};
