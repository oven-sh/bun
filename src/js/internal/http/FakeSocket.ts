const http = require("internal/http");
// A symbol taken out of a pattern is a plain `symbol` for the type checker, and what it keys is untyped.
const kInternalSocketData: typeof http.kInternalSocketData = http.kInternalSocketData;
const serverSymbol: typeof http.serverSymbol = http.serverSymbol;
const shared = require("internal/shared");
const kAutoDestroyed: typeof shared.kAutoDestroyed = shared.kAutoDestroyed;
const Duplex = require("internal/streams/duplex");

type FakeSocket = InstanceType<typeof FakeSocket>;
var FakeSocket = class Socket extends Duplex {
  [kInternalSocketData]?: [$Node.HttpServer, $Node.ServerResponse, Request];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address: Partial<$Node.SocketAddressInfo> | undefined;
  _httpMessage: $Node.OutgoingMessage | null | undefined;
  constructor(httpMessage: $Node.OutgoingMessage | null | undefined) {
    super();
    this._httpMessage = httpMessage;
  }
  address() {
    // Call server.requestIP() without doing any property getter twice.
    var internalData: [$Node.HttpServer, $Node.ServerResponse, Request] | undefined;
    return (this.#address ??=
      (internalData = this[kInternalSocketData])?.[0]?.[serverSymbol]?.requestIP(internalData[2]) ?? {});
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

  _destroy(_err: Error | null, _callback: $Node.ErrorCallback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket
    if (!socketData[1]["req"][kAutoDestroyed]) socketData[1].end();
  }

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

  setTimeout(timeout: number, callback?: () => void) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket

    const http_res = socketData[1];
    http_res?.req?.setTimeout(timeout, callback);
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
