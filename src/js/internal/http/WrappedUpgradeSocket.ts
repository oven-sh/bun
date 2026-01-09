const Duplex = require("internal/streams/duplex");

const kWrappedSocketWritable = Symbol("WrappedSocketWritable");

class WrappedSocket extends Duplex {
  #fetchBody: ReadableStream<Uint8Array> | null = null;
  #resolveNextRead: ((value: Uint8Array | null) => void) | null = null;
  #queue: { value: Buffer | null; cb: () => void }[] = [];
  #ended: boolean = false;
  #res: any;
  #emitClose: () => void;
  constructor(fetchBody: ReadableStream<Uint8Array> | null, res: any, emitClose: () => void) {
    super();
    this.#fetchBody = fetchBody;
    this.#res = res;
    this.#emitClose = emitClose;
  }

  #write(value, cb) {
    if (this.#ended) {
      cb();
      return;
    }
    if (this.#resolveNextRead) {
      this.#resolveNextRead(value);
      this.#resolveNextRead = null;
      cb();
    } else {
      this.#queue.push({ value, cb });
    }
  }

  setNoDelay() {
    return this;
  }

  setKeepAlive() {
    return this;
  }

  setTimeout() {
    return this;
  }

  #end() {
    if (this.#ended) return;
    this.#ended = true;
    this.#res.complete = true;
    this.#res._dump();
    this.#emitClose();
  }

  async *[kWrappedSocketWritable]() {
    while (true) {
      if (this.#queue.length === 0) {
        if (this.listenerCount("drain") > 0) {
          this.emit("drain");
        }
        const { promise, resolve } = Promise.withResolvers();
        this.#resolveNextRead = resolve;
        const value = await promise;
        if (value === null) {
          this.#end();
          break;
        }
        yield value;
      }
      if (this.#queue.length > 0) {
        const { value, cb } = this.#queue.shift();
        if (value !== null) {
          yield value;
          cb();
        } else {
          this.#end();
          cb();
          break;
        }
      }
    }
  }

  async #consumeBody() {
    try {
      if (this.#fetchBody) {
        const reader = await this.#fetchBody.getReader();
        this.#fetchBody = null;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          this.push(value);
        }
        this.push(null);
      }
    } catch (e) {
      if (e.code === "ECONNRESET") {
        // end the readable side gracefully because the server closed the connection
        this.push(null);
      } else {
        this.destroy(e);
      }
    }
  }

  // Writable side proxies to inner writable
  _write(chunk, enc, cb) {
    let buffer = chunk;
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer, enc);
    }
    this.#write(buffer, cb);
  }

  _final(cb) {
    this.#write(null, cb);
    this.#ended = true;
  }

  _read(_size) {
    this.#consumeBody();
  }

  _destroy(err, cb) {
    if (!this.readableEnded) {
      this.push(null);
    }
    this.#write(null, cb);
    cb(err);
  }
}

export default {
  WrappedSocket,
  kWrappedSocketWritable,
};
