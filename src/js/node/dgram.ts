// Hardcoded module "node:dgram"
// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("$shared");

function createSocket() {
  throwNotImplemented("node:dgram createSocket", 1630);
}

function Socket() {
  throwNotImplemented("node:dgram Socket", 1630);
}

function _createSocketHandle() {
  throwNotImplemented("node:dgram _createSocketHandle", 1630);
}

export default {
  createSocket,
  Socket,
  _createSocketHandle,
};

hideFromStack(createSocket, Socket, _createSocketHandle);
