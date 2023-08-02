// Hardcoded module "node:diagnostics_channel"
// This is a stub! None of this is actually implemented yet.

const { hideFromStack, throwNotImplemented } = require("$shared");

class Channel {
  constructor(name) {
    throwNotImplemented("node:diagnostics_channel", 2688);
  }
}

function channel() {
  throwNotImplemented("node:diagnostics_channel", 2688);
}

function hasSubscribers() {
  throwNotImplemented("node:diagnostics_channel", 2688);
}
function subscribe() {
  throwNotImplemented("node:diagnostics_channel", 2688);
}

function unsubscribe() {
  throwNotImplemented("node:diagnostics_channel", 2688);
}

export default {
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  Channel,
};

hideFromStack([channel, hasSubscribers, subscribe, unsubscribe, Channel]);
