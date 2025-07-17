// shim for using process in browser
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
  if (!draining || !currentQueue) {
    return;
  }
  draining = false;
  if (currentQueue.length) {
    queue = currentQueue.concat(queue);
  } else {
    queueIndex = -1;
  }
  if (queue.length) {
    drainQueue();
  }
}

function drainQueue() {
  if (draining) {
    return;
  }
  var timeout = setTimeout(cleanUpNextTick, 0);
  draining = true;
  var len = queue.length;
  while (len) {
    currentQueue = queue;
    queue = [];
    while (++queueIndex < len) {
      if (currentQueue) {
        var item = currentQueue[queueIndex];
        item.fun.apply(null, item.array);
      }
    }
    queueIndex = -1;
    len = queue.length;
  }
  currentQueue = null;
  draining = false;
  clearTimeout(timeout, 0);
}

export function nextTick(fun) {
  var args = new Array(arguments.length - 1);
  if (arguments.length > 1) {
    for (var i = 1; i < arguments.length; i++) {
      args[i - 1] = arguments[i];
    }
  }
  queue.push({ fun, args });
  if (queue.length === 1 && !draining) {
    setTimeout(drainQueue, 0);
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
