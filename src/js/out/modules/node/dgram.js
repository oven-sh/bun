// src/js/node/dgram.js
var hideFromStack = function(fns) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
  }
};
var notimpl = function(message) {
  throw new TODO(message);
};
var createSocket = function() {
  notimpl("createSocket");
};
var Socket = function() {
  notimpl("Socket");
};
var _createSocketHandle = function() {
  notimpl("_createSocketHandle");
};

class TODO extends Error {
  constructor(messageName) {
    const message = messageName ? `node:dgram ${messageName} is not implemented yet in Bun. Track the status and thumbs up the issue: https://github.com/oven-sh/bun/issues/1630` : `node:dgram is not implemented yet in Bun. Track the status and thumbs up the issue: https://github.com/oven-sh/bun/issues/1630`;
    super(message);
    this.name = "TODO";
  }
}
var defaultObject = {
  createSocket,
  Socket,
  _createSocketHandle,
  [Symbol.for("CommonJS")]: 0
};
hideFromStack([TODO.prototype.constructor, notimpl, createSocket, Socket, _createSocketHandle]);
export {
  defaultObject as default,
  createSocket,
  _createSocketHandle,
  Socket
};

//# debugId=9E9990AF2ECB08B764756e2164756e21
