// Hardcoded module "node:inspector" and "node:inspector/promises"
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
      ? `node:inspector ${messageName} is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/2445`
      : `node:inspector is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/2445`;
    super(message);
    this.name = "TODO";
  }
}

function notimpl(message) {
  throw new TODO(message);
}

const { EventEmitter } = import.meta.require("node:events");

function open() {
  notimpl("open");
}

function close() {
  notimpl("close");
}

function url() {
  notimpl("url");
}

function waitForDebugger() {
  notimpl("waitForDebugger");
}

class Session extends EventEmitter {
  constructor() {
    super();
    notimpl("Session");
  }
}

const console = {
  ...globalThis.console,
  context: {
    console: globalThis.console,
  },
};

var defaultObject = {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
  [Symbol.for("CommonJS")]: 0,
};

export { console, open, close, url, waitForDebugger, Session, defaultObject as default };
hideFromStack([notimpl, TODO.prototype.constructor, open, close, url, waitForDebugger, Session.prototype.constructor]);
