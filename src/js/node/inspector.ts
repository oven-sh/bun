// Hardcoded module "node:inspector" and "node:inspector/promises"
// This is a stub! None of this is actually implemented yet.
const { hideFromStack, throwNotImplemented } = require("$shared");
const EventEmitter = require("node:events");

function open() {
  throwNotImplemented("node:inspector open", 2445);
}

function close() {
  throwNotImplemented("node:inspector close", 2445);
}

function url() {
  throwNotImplemented("node:inspector url", 2445);
}

function waitForDebugger() {
  throwNotImplemented("node:inspector waitForDebugger", 2445);
}

class Session extends EventEmitter {
  constructor() {
    super();
    throwNotImplemented("node:inspector Session", 2445);
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
