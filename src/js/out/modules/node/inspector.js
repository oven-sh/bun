// src/js/node/inspector.js
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
var open = function() {
  notimpl("open");
};
var close = function() {
  notimpl("close");
};
var url = function() {
  notimpl("url");
};
var waitForDebugger = function() {
  notimpl("waitForDebugger");
};

class TODO extends Error {
  constructor(messageName) {
    const message = messageName ? `node:inspector ${messageName} is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/2445` : `node:inspector is not implemented yet in Bun. Track the status & thumbs up the issue: https://github.com/oven-sh/bun/issues/2445`;
    super(message);
    this.name = "TODO";
  }
}
var { EventEmitter } = import.meta.require("node:events");

class Session extends EventEmitter {
  constructor() {
    super();
    notimpl("Session");
  }
}
var console = {
  ...globalThis.console,
  context: {
    console: globalThis.console
  }
};
var defaultObject = {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
  [Symbol.for("CommonJS")]: 0
};
hideFromStack([notimpl, TODO.prototype.constructor, open, close, url, waitForDebugger, Session.prototype.constructor]);
export {
  waitForDebugger,
  url,
  open,
  defaultObject as default,
  console,
  close,
  Session
};

//# debugId=87710BD4285192C964756e2164756e21
