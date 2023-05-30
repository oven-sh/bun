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

// src/js/node/inspector.ts
var EventEmitter = require("node:events");
var open = function() {
  throwNotImplemented("node:inspector open", 2445);
}, close = function() {
  throwNotImplemented("node:inspector close", 2445);
}, url = function() {
  throwNotImplemented("node:inspector url", 2445);
}, waitForDebugger = function() {
  throwNotImplemented("node:inspector waitForDebugger", 2445);
};

class Session extends EventEmitter {
  constructor() {
    super();
    throwNotImplemented("node:inspector Session", 2445);
  }
}
var console = {
  ...globalThis.console,
  context: {
    console: globalThis.console
  }
}, defaultObject = {
  console,
  open,
  close,
  url,
  waitForDebugger,
  Session,
  [Symbol.for("CommonJS")]: 0
};
hideFromStack(open, close, url, waitForDebugger, Session.prototype.constructor);
export {
  waitForDebugger,
  url,
  open,
  defaultObject as default,
  console,
  close,
  Session
};

//# debugId=1460E866D5DCE59364756e2164756e21
