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

// src/js/node/diagnostics_channel.js
var channel = function() {
  throwNotImplemented("node:diagnostics_channel", 2688);
}, hasSubscribers = function() {
  throwNotImplemented("node:diagnostics_channel", 2688);
}, subscribe = function() {
  throwNotImplemented("node:diagnostics_channel", 2688);
}, unsubscribe = function() {
  throwNotImplemented("node:diagnostics_channel", 2688);
};

class Channel {
  constructor(name) {
    throwNotImplemented("node:diagnostics_channel", 2688);
  }
}
var defaultObject = {
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  Channel,
  [Symbol.for("CommonJS")]: 0
};
hideFromStack([channel, hasSubscribers, subscribe, unsubscribe, Channel]);
export {
  unsubscribe,
  subscribe,
  hasSubscribers,
  defaultObject as default,
  channel,
  Channel
};
