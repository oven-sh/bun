// @module "node:dgram"
// This is a stub! None of this is actually implemented yet.

function hideFromStack(fns) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::",
    });
  }
}

class TODO extends Error {
  constructor(messageName) {
    const message = messageName
      ? `node:dgram ${messageName} is not implemented yet in Bun. Track the status and thumbs up the issue: https://github.com/oven-sh/bun/issues/1630`
      : `node:dgram is not implemented yet in Bun. Track the status and thumbs up the issue: https://github.com/oven-sh/bun/issues/1630`;
    super(message);
    this.name = "TODO";
  }
}

function notimpl(message) {
  throw new TODO(message);
}

function createSocket() {
  notimpl("createSocket");
}

function Socket() {
  notimpl("Socket");
}

function _createSocketHandle() {
  notimpl("_createSocketHandle");
}

const defaultObject = {
  createSocket,
  Socket,
  _createSocketHandle,
  [Symbol.for("CommonJS")]: 0,
};

export { defaultObject as default, Socket, createSocket, _createSocketHandle };

hideFromStack([TODO.prototype.constructor, notimpl, createSocket, Socket, _createSocketHandle]);
