class Timeout {
  #id;
  #refCount = 1;
  #clearFunction;

  constructor(id, clearFunction) {
    this.#id = id;
    this.#refCount = 1;
    this.#clearFunction = clearFunction;
  }

  ref() {
    this.#refCount += 1;
  }

  hasRef() {
    return this.#refCount > 0;
  }

  unref() {
    this.#refCount -= 1;
    var clearFunction = this.#clearFunction;
    if (clearFunction && this.#refCount === 0) {
      this.#clearFunction = null;
      clearFunction(this.#id);
    }
  }
}
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
