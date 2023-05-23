// Hardcoded module "node:diagnostics_channel"
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
      ? `node:diagnostics_channel ${messageName} is not implemented yet in Bun.`
      : `node:diagnostics_channel is not implemented yet in Bun.`;
    super(message);
    this.name = "TODO";
  }
}

function notimpl() {
  throw new TODO();
}

class Channel {
  constructor(name) {
    notimpl();
  }
}

function channel() {
  notimpl();
}

function hasSubscribers() {
  notimpl();
}
function subscribe() {
  notimpl();
}

function unsubscribe() {
  notimpl();
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

hideFromStack([TODO.prototype.constructor, notimpl, channel, hasSubscribers, subscribe, unsubscribe, Channel]);
