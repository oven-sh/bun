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

let pushToReadableWorkerStdio: (stream: ReadableWorkerStdio, chunk: Buffer) => void;

class ReadableWorkerStdio extends Readable {
  #chunks: Buffer[] = [];
  #done = false;

  constructor(worker: globalThis.Worker) {
    super();
    worker.addEventListener("close", () => {
      this.#done = true;
    });
  }

  static {
    pushToReadableWorkerStdio = (stream, chunk) => {
      stream.#chunks.push(chunk);
    };
  }

  _read() {
    if (this.#chunks.length > 0) {
      this.push(this.#chunks.shift());
    } else if (this.#done) {
      this.push(null);
    }
  }
}

// Map to access the stdout and stderr streams from an internal Web Worker object (not a worker_threads Worker)
const webWorkerToStdio = new WeakMap<globalThis.Worker, { stdout: ReadableWorkerStdio; stderr: ReadableWorkerStdio }>();

export default {
  WritableWorkerStdio,
  ReadableWorkerStdio,
  _workerData,
  _threadId,
  _receiveMessageOnPort,
  environmentData,
  pushStdioToParent,
  webWorkerToStdio,
  pushToReadableWorkerStdio,
};
