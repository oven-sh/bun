export const setInterval = globalThis.setInterval;
export const setImmediate = globalThis.queueMicrotask;
export const setTimeout = globalThis.setTimeout;
export const clearInterval = globalThis.clearInterval;

// not implemented
export const clearImmediate = () => {};

export const clearTimeout = globalThis.clearTimeout;
export const queueMicrotask = globalThis.queueMicrotask;

export default {
  setInterval,
  queueMicrotask,
  setImmediate,
  setTimeout,
  clearInterval,
  clearImmediate,
  clearTimeout,
};
