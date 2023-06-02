// Hardcoded module "node:diagnostics_channel"
// This is a stub! None of this is actually implemented yet.

import { hideFromStack, throwNotImplemented } from "../shared";

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

const defaultObject = {
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  Channel,
  [Symbol.for("CommonJS")]: 0,
};

export { defaultObject as default, Channel, channel, hasSubscribers, subscribe, unsubscribe };

hideFromStack([channel, hasSubscribers, subscribe, unsubscribe, Channel]);
