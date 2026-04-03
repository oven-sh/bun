const { Duplex } = require("internal/stream");

class UpgradedSocket extends Duplex {
  #reader;
  #channel;
  #reading = false;

  constructor(responseBody, channel) {
    super();
    this.#channel = channel;
    if (responseBody) {
      this.#reader = responseBody.getReader();
    }
  }

  async #pump() {
    const reader = this.#reader;
    if (!reader) {
      this.push(null);
      return;
    }
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        if (!this.push(Buffer.from(value))) {
          return;
        }
      }
    } catch (err) {
      this.destroy(err);
    }
  }

  _read(_size) {
    if (this.#reading) return;
    this.#reading = true;
    this.#pump().finally(() => {
      this.#reading = false;
    });
  }

  _write(chunk, encoding, callback) {
    let buffer = chunk;
    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer, encoding);
    }
    this.#channel.push(buffer);
    callback();
  }

  _final(callback) {
    this.#channel.end();
    callback();
  }

  _destroy(err, callback) {
    const reader = this.#reader;
    this.#reader = undefined;
    if (reader) {
      try {
        reader.cancel().catch(() => {});
      } catch {}
    }
    this.#channel.end();
    callback(err);
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

  ref() {
    return this;
  }

  unref() {
    return this;
  }
}

Object.defineProperty(UpgradedSocket, "name", { value: "Socket" });

export default {
  UpgradedSocket,
};
