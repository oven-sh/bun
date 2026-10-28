// What the compiler reads in place of src/js/internal/http/FakeSocket.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 3bbff026b2c4b0a0f04c4c75c2bfd13cde10fc227ab1f57ef15f259a7782d87c.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.

const Duplex = require("internal/streams/duplex");

type FakeSocket = InstanceType<typeof FakeSocket>;
var FakeSocket = class Socket extends Duplex {
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address: Partial<$Node.SocketAddressInfo> = {};
  _httpMessage: $Node.OutgoingMessage | null | undefined;
  constructor(httpMessage: $Node.OutgoingMessage | null | undefined) {
    super();
    this._httpMessage = httpMessage;
  }
  address() {
    return this.#address;
  }

  get bufferSize() {
    return this.writableLength;
  }

  connect(_port?: unknown, _host?: unknown, _connectListener?: unknown) {
    return this;
  }
  _onTimeout = function (this: $Node.Duplex) {
    this.emit("timeout");
  };

  _destroy(_err: Error | null, _callback: $Node.ErrorCallback) {}

  _final(_callback: $Node.ErrorCallback) {}

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

  _read(_size: number) {}

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

  set remoteAddress(val: string | undefined) {
    // initialize the object so that other properties wouldn't be lost
    this.address().address = val;
  }

  get remotePort() {
    return this.address()?.port;
  }

  set remotePort(val: number | undefined) {
    // initialize the object so that other properties wouldn't be lost
    this.address().port = val;
  }

  get remoteFamily() {
    return this.address()?.family;
  }

  set remoteFamily(val: string | undefined) {
    // initialize the object so that other properties wouldn't be lost
    this.address().family = val;
  }

  resetAndDestroy() {
    return this;
  }

  setKeepAlive(_enable = false, _initialDelay = 0) {
    return this;
  }

  setNoDelay(_noDelay = true) {
    return this;
  }

  setTimeout(_timeout: number, _callback?: () => void) {
    return this;
  }

  unref() {
    return this;
  }

  _write(_chunk: unknown, _encoding: string, _callback: $Node.ErrorCallback) {}

  destroy() {
    this._httpMessage?.destroy?.();
    return super.destroy();
  }
};

Object.defineProperty(FakeSocket, "name", { value: "Socket" });

export default {
  FakeSocket,
};
