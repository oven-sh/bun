// Hardcoded module "node:dgram"
// This is a stub! None of this is actually implemented yet.
import { hideFromStack, throwNotImplemented } from "../shared";

function createSocket() {
  throwNotImplemented("node:dgram createSocket", 1630);
}

function Socket() {
  throwNotImplemented("node:dgram Socket", 1630);
}

function _createSocketHandle() {
  throwNotImplemented("node:dgram _createSocketHandle", 1630);
}

const defaultObject = {
  createSocket,
  Socket,
  _createSocketHandle,
  [Symbol.for("CommonJS")]: 0,
};

export { defaultObject as default, Socket, createSocket, _createSocketHandle };

hideFromStack(createSocket, Socket, _createSocketHandle);
