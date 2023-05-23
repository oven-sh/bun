function throwNotImplemented(feature, issue) {
  throw hideFromStack(throwNotImplemented), new NotImplementedError(feature, issue);
}
function hideFromStack(...fns) {
  for (let fn of fns)
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
}

class NotImplementedError extends Error {
  code;
  constructor(feature, issue) {
    super(feature + " is not yet implemented in Bun." + (issue ? " Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/" + issue : ""));
    this.name = "NotImplementedError", this.code = "ERR_NOT_IMPLEMENTED", hideFromStack(NotImplementedError);
  }
}

// src/js/node/dgram.ts
var createSocket = function() {
  throwNotImplemented("node:dgram createSocket", 1630);
}, Socket = function() {
  throwNotImplemented("node:dgram Socket", 1630);
}, _createSocketHandle = function() {
  throwNotImplemented("node:dgram _createSocketHandle", 1630);
}, defaultObject = {
  createSocket,
  Socket,
  _createSocketHandle,
  [Symbol.for("CommonJS")]: 0
};
hideFromStack(createSocket, Socket, _createSocketHandle);
export {
  defaultObject as default,
  createSocket,
  _createSocketHandle,
  Socket
};

//# debugId=38E94E4318A171FA64756e2164756e21
