const { Duplex } = require("internal/stream");

const HIGH_WATER_MARK = 64 * 1024;

class UpgradedSocket extends Duplex {
  #reader;
  #channel;
  #reading = false;
  #url;
  #addressInfo;
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  encrypted = false;
  authorized = false;

  constructor(responseBody, channel, url) {
    super();
    this.#channel = channel;
    this.#url = url;
    this.encrypted = typeof url === "string" && url.startsWith("https:");
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
        const buf = Buffer.from(value);
        this.bytesRead += buf.length;
        if (!this.push(buf)) {
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
    this.bytesWritten += buffer.length;
    this.#channel.pushBuffered(buffer, callback);
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

  #parseAddress() {
    if (this.#addressInfo) return this.#addressInfo;
    const url = this.#url;
    let address = "";
    let port = 0;
    let family: "IPv4" | "IPv6" = "IPv4";
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        let host = parsed.hostname;
        if (host.startsWith("[") && host.endsWith("]")) {
          host = host.slice(1, -1);
          family = "IPv6";
        } else if (host.includes(":")) {
          family = "IPv6";
        }
        address = host;
        const portStr = parsed.port;
        if (portStr) {
          port = Number(portStr) | 0;
        } else {
          port = parsed.protocol === "https:" ? 443 : 80;
        }
      } catch {}
    }
    return (this.#addressInfo = { address, port, family });
  }

  address() {
    const info = this.#parseAddress();
    return { address: info.address, family: info.family, port: info.port };
  }

  get remoteAddress() {
    return this.#parseAddress().address;
  }

  get remoteFamily() {
    return this.#parseAddress().family;
  }

  get remotePort() {
    return this.#parseAddress().port;
  }

  get localAddress() {
    return this.#parseAddress().family === "IPv6" ? "::" : "0.0.0.0";
  }

  get localFamily() {
    return this.#parseAddress().family;
  }

  get localPort() {
    return 0;
  }

  get bufferSize() {
    return this.writableLength;
  }

  get pending() {
    return this.connecting;
  }

  get readyState() {
    if (this.connecting) return "opening";
    if (this.readable) {
      return this.writable ? "open" : "readOnly";
    } else {
      return this.writable ? "writeOnly" : "closed";
    }
  }

  setNoDelay() {
    return this;
  }

  setKeepAlive() {
    return this;
  }

  setTimeout(timeout, callback) {
    if (callback) this.once("timeout", callback);
    return this;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  resetAndDestroy() {
    return this.destroy();
  }
}

Object.defineProperty(UpgradedSocket, "name", { value: "Socket" });

export default {
  UpgradedSocket,
  HIGH_WATER_MARK,
};
