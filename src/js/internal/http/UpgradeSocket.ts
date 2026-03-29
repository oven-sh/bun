const { Duplex } = require("internal/stream");

const kReader = Symbol("reader");
const kWriter = Symbol("writer");
const kReading = Symbol("reading");
const kWriterEnded = Symbol("writerEnded");

interface UpgradeSocketWriter {
  push(chunk: Buffer): void;
  end(): void;
}

type UpgradeSocket = InstanceType<typeof UpgradeSocket>;
var UpgradeSocket = class UpgradeSocket extends Duplex {
  [kReader]: ReadableStreamDefaultReader | null;
  [kWriter]: UpgradeSocketWriter;
  [kReading]: boolean;
  [kWriterEnded]: boolean;

  constructor(responseBody: ReadableStream | null, writer: UpgradeSocketWriter) {
    super();
    this[kReader] = responseBody ? responseBody.getReader() : null;
    this[kWriter] = writer;
    this[kReading] = false;
    this[kWriterEnded] = false;

    if (this[kReader]) {
      this.#pump();
    }
  }

  #pump() {
    const reader = this[kReader];
    if (!reader || this[kReading]) return;
    this[kReading] = true;

    reader
      .read()
      .then(({ done, value }: { done: boolean; value?: Uint8Array }) => {
        this[kReading] = false;
        if (done || this.destroyed) {
          if (!this.destroyed) this.push(null);
          return;
        }
        if (!this.push(value)) {
          return;
        }
        this.#pump();
      })
      .catch((err: Error) => {
        this[kReading] = false;
        if (!this.destroyed) {
          this.destroy(err);
        }
      });
  }

  _read(_size: number) {
    this.#pump();
  }

  _write(chunk: any, encoding: string, callback: (err?: Error | null) => void) {
    if (typeof chunk === "string") {
      chunk = Buffer.from(chunk, encoding);
    }
    this[kWriter].push(chunk);
    callback();
  }

  #endWriter() {
    if (this[kWriterEnded]) return;
    this[kWriterEnded] = true;
    this[kWriter].end();
  }

  _final(callback: (err?: Error | null) => void) {
    this.#endWriter();
    callback();
  }

  _destroy(err: Error | null, callback: (err?: Error | null) => void) {
    const reader = this[kReader];
    if (reader) {
      this[kReader] = null;
      reader.cancel().catch(() => {});
    }
    this.#endWriter();
    callback(err);
  }

  setTimeout(timeout: number, callback?: () => void) {
    if (callback) {
      if (timeout === 0) {
        this.removeListener("timeout", callback);
      } else {
        this.once("timeout", callback);
      }
    }
    return this;
  }

  address() {
    return {};
  }

  get remoteAddress() {
    return undefined;
  }

  get remotePort() {
    return undefined;
  }

  get remoteFamily() {
    return undefined;
  }

  get localAddress() {
    return undefined;
  }

  get localPort() {
    return undefined;
  }

  setKeepAlive(_enable = false, _initialDelay = 0) {
    return this;
  }

  setNoDelay(_noDelay = true) {
    return this;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  resetAndDestroy() {
    this.destroy();
    return this;
  }
};

Object.defineProperty(UpgradeSocket, "name", { value: "Socket" });

export default {
  UpgradeSocket,
};
