const { kInternalSocketData, serverSymbol } = require("internal/http");
const { kAutoDestroyed } = require("internal/shared");
const { Stream, Duplex } = require("internal/stream");

type FakeSocket = InstanceType<typeof FakeSocket>;
var FakeSocket = class Socket extends Duplex {
  [kInternalSocketData]!: [typeof Server, typeof OutgoingMessage, typeof Request];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address;
  address() {
    // Call server.requestIP() without doing any property getter twice.
    var internalData;
    return (this.#address ??=
      (internalData = this[kInternalSocketData])?.[0]?.[serverSymbol].requestIP(internalData[2]) ?? {});
  }

  get bufferSize() {
    return this.writableLength;
  }

  connect(port, host, connectListener) {
    return this;
  }

  _destroy(err, callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket
    if (!socketData[1]["req"][kAutoDestroyed]) socketData[1].end();
  }

  _final(callback) {}

  get localAddress() {
    return this.address() ? "127.0.0.1" : undefined;
  }

  get localFamily() {
    return "IPv4";
  }

  get localPort() {
    return 80;
  }

  get pending() {
    return this.connecting;
  }

  _read(size) {}

  get readyState() {
    if (this.connecting) return "opening";
    if (this.readable) {
      return this.writable ? "open" : "readOnly";
    } else {
      return this.writable ? "writeOnly" : "closed";
    }
  }

  ref() {
    return this;
  }

  get remoteAddress() {
    return this.address()?.address;
  }

  set remoteAddress(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().address = val;
  }

  get remotePort() {
    return this.address()?.port;
  }

  set remotePort(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().port = val;
  }

  get remoteFamily() {
    return this.address()?.family;
  }

  set remoteFamily(val) {
    // initialize the object so that other properties wouldn't be lost
    this.address().family = val;
  }

  resetAndDestroy() {}

  setKeepAlive(enable = false, initialDelay = 0) {}

  setNoDelay(noDelay = true) {
    return this;
  }

  setTimeout(timeout, callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket

    const [server, http_res, req] = socketData;
    http_res?.req?.setTimeout(timeout, callback);
    return this;
  }

  unref() {
    return this;
  }

  _write(chunk, encoding, callback) {}
};

Object.defineProperty(FakeSocket, "name", { value: "Socket" });

export default {
  FakeSocket,
};
