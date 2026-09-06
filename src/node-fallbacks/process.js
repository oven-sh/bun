// shim for using process in browser
var queue = [];
var draining = false;

function scheduleDrain() {
  if (typeof queueMicrotask === "function") {
    queueMicrotask(drainQueue);
  } else {
    Promise.resolve().then(drainQueue);
  }
}

function drainQueue() {
  draining = true;
  var i = 0;
  try {
    // Callbacks queued while draining run in the same pass, like node.
    for (; i < queue.length; i++) {
      var item = queue[i];
      item.fun.apply(null, item.args);
    }
  } finally {
    // On a throw, drop the callback that threw and keep the rest.
    queue = queue.slice(i + 1);
    draining = false;
    if (queue.length) scheduleDrain();
  }
}

export function nextTick(fun, ...args) {
  if (typeof fun !== "function") {
    throw new TypeError('The "callback" argument must be of type function. Received ' + typeof fun);
  }
  queue.push({ fun, args });
  if (queue.length === 1 && !draining) {
    scheduleDrain();
  }
}

export const title = "browser";
export const browser = true;
export const env = {};
export const argv = [];
export const version = ""; // empty string to avoid regexp issues
export const versions = {};

function noop() {}

export const on = noop;
export const addListener = noop;
export const once = noop;
export const off = noop;
export const removeListener = noop;
export const removeAllListeners = noop;
export const emit = noop;
export const prependListener = noop;
export const prependOnceListener = noop;
export const emitWarning = function (warning, type) {
  var name = typeof type === "string" ? type : (type && type.type) || "Warning";
  console.warn(name + ": " + (warning && warning.message ? warning.message : warning));
};

export const listeners = function (name) {
  return [];
};

export const binding = function (name) {
  throw new Error("process.binding is not supported in browser polyfill");
};

export const cwd = function () {
  return "/";
};

export const chdir = function (dir) {
  throw new Error("process.chdir is not supported in browser polyfill");
};

export const umask = function () {
  return 0;
};

export default {
  nextTick,
  title,
  browser,
  env,
  argv,
  version,
  versions,
  on,
  addListener,
  once,
  off,
  removeListener,
  removeAllListeners,
  emit,
  prependListener,
  prependOnceListener,
  emitWarning,
  listeners,
  binding,
  cwd,
  chdir,
  umask,
};
