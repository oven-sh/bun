// src/js/node/diagnostics_channel.js
var hideFromStack = function(fns) {
  for (const fn of fns) {
    Object.defineProperty(fn, "name", {
      value: "::bunternal::"
    });
  }
};
var notimpl = function() {
  throw new TODO;
};
var channel = function() {
  notimpl();
};
var hasSubscribers = function() {
  notimpl();
};
var subscribe = function() {
  notimpl();
};
var unsubscribe = function() {
  notimpl();
};

class TODO extends Error {
  constructor(messageName) {
    const message = messageName ? `node:diagnostics_channel ${messageName} is not implemented yet in Bun.` : `node:diagnostics_channel is not implemented yet in Bun.`;
    super(message);
    this.name = "TODO";
  }
}

class Channel {
  constructor(name) {
    notimpl();
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
hideFromStack([TODO.prototype.constructor, notimpl, channel, hasSubscribers, subscribe, unsubscribe, Channel]);
export {
  unsubscribe,
  subscribe,
  hasSubscribers,
  defaultObject as default,
  channel,
  Channel
};

//# debugId=35D8B21C8D3D6D1864756e2164756e21
