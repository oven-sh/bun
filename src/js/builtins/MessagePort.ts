// Node.js MessagePort inherits from NodeEventTarget. These are bootstrap stubs:
// the first call to any of them loads internal/worker/messageport_emitter, which
// installs the real methods on an intermediate prototype and deletes these
// own-property stubs so subsequent lookups hit the inherited implementations.
// Without them, `port.on(...)` throws TypeError until something in the process
// happens to load node:worker_threads.

export function on(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.on.$apply(this, arguments);
}

export function off(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.off.$apply(this, arguments);
}

export function once(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.once.$apply(this, arguments);
}

export function emit(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.emit.$apply(this, arguments);
}

export function addListener(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.addListener.$apply(this, arguments);
}

export function removeListener(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.removeListener.$apply(this, arguments);
}

export function listenerCount(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.listenerCount.$apply(this, arguments);
}

export function eventNames(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.eventNames.$apply(this, arguments);
}

export function removeAllListeners(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.removeAllListeners.$apply(this, arguments);
}

export function setMaxListeners(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.setMaxListeners.$apply(this, arguments);
}

export function getMaxListeners(this: MessagePort) {
  require("internal/worker/messageport_emitter");
  return this.getMaxListeners.$apply(this, arguments);
}
