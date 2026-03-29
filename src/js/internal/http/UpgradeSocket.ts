const { Duplex } = require("internal/stream");

const kReader = Symbol("reader");
const kWriter = Symbol("writer");

type WriterCallback = (chunk: Buffer | undefined) => void;

interface UpgradeSocketWriter {
  push(chunk: Buffer): void;
  end(): void;
}

type UpgradeSocket = InstanceType<typeof UpgradeSocket>;
var UpgradeSocket = class UpgradeSocket extends Duplex {
  [kReader]: ReadableStreamDefaultReader | null;
  [kWriter]: UpgradeSocketWriter;

  constructor(responseBody: ReadableStream | null, writer: UpgradeSocketWriter) {
    super();
    this[kReader] = responseBody ? responseBody.getReader() : null;
    this[kWriter] = writer;

    if (this[kReader]) {
      this.#pump();
    }
  }

  #pump() {
    const reader = this[kReader];
    if (!reader) return;

    reader
      .read()
      .then(({ done, value }: { done: boolean; value?: Uint8Array }) => {
        if (done) {
          this.push(null);
          return;
        }
        if (!this.destroyed) {
          this.push(value);
        }
        this.#pump();
      })
      .catch(() => {
        if (!this.destroyed) {
          this.push(null);
        }
      });
  }

  _read(_size: number) {}

  _write(chunk: any, encoding: string, callback: (err?: Error | null) => void) {
    if (typeof chunk === "string") {
      chunk = Buffer.from(chunk, encoding);
    }
    this[kWriter].push(chunk);
    callback();
  }

  _final(callback: (err?: Error | null) => void) {
    this[kWriter].end();
    callback();
  }

  _destroy(err: Error | null, callback: (err?: Error | null) => void) {
    const reader = this[kReader];
    if (reader) {
      this[kReader] = null;
      reader.cancel().catch(() => {});
    }
    this[kWriter].end();
    callback(err);
  }

  setKeepAlive(_enable = false, _initialDelay = 0) {}

  setNoDelay(_noDelay = true) {
    return this;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  resetAndDestroy() {}
};

Object.defineProperty(UpgradeSocket, "name", { value: "Socket" });

export default {
  UpgradeSocket,
};
