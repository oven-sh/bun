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

  _write(chunk: any, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    pushStdioToParent(this.#fd, chunk);
  }
}

class ReadableWorkerStdio extends Readable {}

export default {
  WritableWorkerStdio,
  ReadableWorkerStdio,
  _workerData,
  _threadId,
  _receiveMessageOnPort,
  environmentData,
  pushStdioToParent,
};
