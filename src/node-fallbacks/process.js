// shim for using process in browser
var queue = [];
var batch = [];
var index = 0;
var draining = false;
var scheduled = false;

// node runs ticks before queued promise jobs. A browser has no hook for that, so the drain is one microtask.
function scheduleDrain() {
  scheduled = true;
  queueMicrotask(drainQueue);
}

function drainQueue() {
  scheduled = false;
  draining = true;
  try {
    // Ticks queued mid-drain run in the same pass, like node. A fresh array per batch lets finished ticks be freed.
    for (;;) {
      while (index < batch.length) {
        var item = batch[index++];
        item.fun.apply(undefined, item.args);
      }
      if (!queue.length) break;
      batch = queue;
      queue = [];
      index = 0;
    }
  } finally {
    // On a throw, `index` is past the callback that threw. The rest of the batch runs first in the next drain.
    if (index >= batch.length) {
      batch = [];
      index = 0;
    }
    draining = false;
    if (batch.length || queue.length) scheduleDrain();
  }
}

export function nextTick(fun, ...args) {
  if (typeof fun !== "function") {
    var received = fun === null ? "null" : typeof fun;
    var err = new TypeError('The "callback" argument must be of type function. Received ' + received);
    err.code = "ERR_INVALID_ARG_TYPE";
    throw err;
  }
  queue.push({ fun, args });
  if (!draining && !scheduled) scheduleDrain();
}

export const title = "browser";
// Not named `browser`: a content script of an extension is a classic script, which declares its top-level
// bindings on the global object, and `browser` is the extension API there. README.md has the cases.
const processBrowser = true;
export { processBrowser as browser };
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
