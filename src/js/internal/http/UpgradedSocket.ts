const { Duplex } = require("internal/stream");

const HIGH_WATER_MARK = 64 * 1024;

class UpgradedSocket extends Duplex {
  #reader;
  #channel;
  #reading = false;
  #url;
  #addressInfo;
  #timeoutTimer;
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  encrypted = false;
  authorized = false;

  constructor(responseBody, channel, url, rejectUnauthorized = true) {
    // allowHalfOpen:false matches net.Socket (Duplex defaults to true).
    // Without this, server EOF ends only the readable side — _final() is
    // never called, channel.end() never fires, and the body generator leaks.
    super({
      allowHalfOpen: false,
      readableHighWaterMark: HIGH_WATER_MARK,
      writableHighWaterMark: HIGH_WATER_MARK,
    });
    this.#channel = channel;
    this.#url = url;
    this.encrypted = typeof url === "string" && url.startsWith("https:");
    // A 101 over https:// with rejectUnauthorized=true (fetch's default)
    // necessarily passed CA verification. When rejectUnauthorized is false,
    // the TLS handshake may have accepted an unverified cert — authorized
    // must stay false so consumers (like ws) don't treat the peer as trusted.
    this.authorized = this.encrypted && rejectUnauthorized !== false;
    if (responseBody) {
      this.#reader = responseBody.getReader();
    }
  }

  #refreshTimeout() {
    if (this.timeout <= 0) return;
    if (this.#timeoutTimer) clearTimeout(this.#timeoutTimer);
    this.#timeoutTimer = setTimeout(() => {
      this.#timeoutTimer = undefined;
      this.emit("timeout");
    }, this.timeout);
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
        this.#refreshTimeout();
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
    this.#refreshTimeout();
    this.#channel.pushBuffered(buffer, callback);
  }

  _final(callback) {
    this.#channel.end();
    callback();
  }

  _destroy(err, callback) {
    const reader = this.#reader;
    this.#reader = undefined;
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = undefined;
    }
    if (reader) {
      try {
        reader.cancel().catch(() => {});
      } catch {}
    }
    // Forward the destroy error so queued socket.write callbacks see the
    // failure instead of a silent success. Even without an explicit error
    // (socket.destroy() with no argument), raise ERR_STREAM_DESTROYED so
    // waiters aren't falsely signaled as successful.
    this.#channel.end(err ?? $ERR_STREAM_DESTROYED("write"));
    callback(err);
  }

  #parseAddress() {
    if (this.#addressInfo) return this.#addressInfo;
    const url = this.#url;
    let address: string | undefined;
    let port: number | undefined;
    let family: "IPv4" | "IPv6" | undefined;
    if (typeof url === "string") {
      try {
        const parsed = new URL(url);
        let host = parsed.hostname;
        if (host.startsWith("[") && host.endsWith("]")) {
          host = host.slice(1, -1);
          family = "IPv6";
        } else if (host.includes(":")) {
          family = "IPv6";
        } else {
          family = "IPv4";
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
    // net.Socket.address() returns the LOCAL (bound) endpoint. We don't have
    // a real bound address, so return an empty object — matches FakeSocket.
    return {};
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
    return undefined;
  }

  get localFamily() {
    return undefined;
  }

  get localPort() {
    return undefined;
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
    if (this.#timeoutTimer) {
      clearTimeout(this.#timeoutTimer);
      this.#timeoutTimer = undefined;
    }
    this.timeout = timeout;
    if (timeout === 0) {
      // Node semantics: setTimeout(0, cb) REMOVES the listener instead of adding.
      if (callback) this.removeListener("timeout", callback);
    } else {
      if (callback) this.once("timeout", callback);
      this.#timeoutTimer = setTimeout(() => {
        this.#timeoutTimer = undefined;
        this.emit("timeout");
      }, timeout);
    }
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
