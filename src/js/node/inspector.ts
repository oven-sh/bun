// Hardcoded module "node:inspector" and "node:inspector/promises"
// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("internal/shared");
const EventEmitter = require("node:events");

function open() {
  throwNotImplemented("node:inspector", 2445);
}

function close() {
  throwNotImplemented("node:inspector", 2445);
}

function url() {
  // Return undefined since that is allowed by the Node.js API
  // https://nodejs.org/api/inspector.html#inspectorurl
  return undefined;
}

function waitForDebugger() {
  throwNotImplemented("node:inspector", 2445);
}

class Session extends EventEmitter {
  constructor() {
    super();
    throwNotImplemented("node:inspector", 2445);
  }
}

const console = {
  ...globalThis.console,
  context: {
    console: globalThis.console,
  },
};

export default {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
};

hideFromStack(open, close, url, waitForDebugger, Session.prototype.constructor);
