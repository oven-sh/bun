// This implementation isn't 100% correct
// Ref/unref does not impact whether the process is kept alive

var clear = Symbol("clear");
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

  [clear]() {
    this.#refCount = 0;
    var clearFunction = this.#clearFunction;
    if (clearFunction) {
      this.#clearFunction = null;
      clearFunction(this.#id);
    }
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
var {
  setTimeout: setTimeout_,
  setImmediate: setImmediate_,
  clearTimeout: clearTimeout_,
  setInterval: setInterval_,
  clearInterval: clearInterval_,
} = globalThis;

export function setImmediate(callback, ...args) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }
  var cleared = false;
  function clearImmediate(id) {
    cleared = true;
  }

  const wrapped = function (callback, args) {
    if (cleared) {
      return;
    }
    cleared = true;
    try {
      callback(...args);
    } catch (e) {
      reportError(e);
    } finally {
    }
  };

  return new Timeout(setImmediate_(wrapped, callback, args), clearImmediate);
}

export function setTimeout(callback, delay, ...args) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  return new Timeout(setTimeout_.apply(globalThis, arguments), clearTimeout_);
}

export function setInterval(callback, delay, ...args) {
  if (typeof callback !== "function") {
    throw new TypeError("callback must be a function");
  }

  return new Timeout(setInterval_.apply(globalThis, arguments), clearInterval_);
}

export function clearTimeout(id) {
  if (id && typeof id === "object" && id[clear]) {
    id[clear]();
    return;
  }

  clearTimeout_(id);
}

export function clearInterval(id) {
  if (id && typeof id === "object" && id[clear]) {
    id[clear]();
    return;
  }

  clearInterval_(id);
}

export default {
  setInterval,
  setImmediate,
  setTimeout,
  clearInterval,
  clearTimeout,
  [Symbol.for("CommonJS")]: 0,
};
