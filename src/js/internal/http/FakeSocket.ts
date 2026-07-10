const { kInternalSocketData, serverSymbol, installSocketStubs } = require("internal/http");
const { kAutoDestroyed } = require("internal/shared");
const { Duplex } = require("internal/stream");

type FakeSocket = InstanceType<typeof FakeSocket>;
var FakeSocket = class Socket extends Duplex {
  [kInternalSocketData]!: [typeof Server, typeof OutgoingMessage, typeof Request];
  bytesRead = 0;
  bytesWritten = 0;
  connecting = false;
  timeout = 0;
  isServer = false;

  #address;
  _httpMessage: any;
  constructor(httpMessage: any) {
    super();
    this._httpMessage = httpMessage;
  }
  address() {
    // Call server.requestIP() without doing any property getter twice.
    var internalData;
    return (this.#address ??=
      (internalData = this[kInternalSocketData])?.[0]?.[serverSymbol]?.requestIP(internalData[2]) ?? {});
  }

  _onTimeout = function () {
    this.emit("timeout");
  };

  _destroy(_err, _callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket
    if (!socketData[1]["req"][kAutoDestroyed]) socketData[1].end();
  }

  _final(_callback) {}

  get localAddress() {
    return this.address() ? "127.0.0.1" : undefined;
  }

  get localFamily() {
    return "IPv4";
  }

  get localPort() {
    return 80;
  }

  _read(_size) {}

  setTimeout(timeout, callback) {
    const socketData = this[kInternalSocketData];
    if (!socketData) return; // sometimes 'this' is Socket not FakeSocket

    const http_res = socketData[1];
    http_res?.req?.setTimeout(timeout, callback);
    return this;
  }

  _write(_chunk, _encoding, _callback) {}

  destroy() {
    this._httpMessage?.destroy?.();
    return super.destroy();
  }
};

installSocketStubs(FakeSocket);
Object.defineProperty(FakeSocket, "name", { value: "Socket" });

export default {
  FakeSocket,
};
