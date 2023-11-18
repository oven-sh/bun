var StatWatcher;
const statWatchers = new Map();
let _pathModule;

function getValidatedPath(p) {
  if (p instanceof URL) return Bun.fileURLToPath(p);
  if (typeof p !== "string") throw new TypeError("Path must be a string or URL.");
  return (_pathModule ??= require("node:path")).resolve(p);
}

function watchFile(filename, options, listener) {
  filename = getValidatedPath(filename);

  if (typeof options === "function") {
    listener = options;
    options = {};
  }

  if (typeof listener !== "function") {
    throw new TypeError("listener must be a function");
  }

  var stat = statWatchers.get(filename);
  if (!stat) {
    stat = new (StatWatcher ??= load())(filename, options);
    statWatchers.set(filename, stat);
  }
  stat.addListener("change", listener);
  return stat;
}

function load() {
  var bunFS;
  const EventEmitter = require("node:events");
  var doWatchFile = (a, b, c) => {
    bunFS = Bun.fs();
    doWatchFile = bunFS.watchFile.bind(bunFS);
    return bunFS.watchFile(a, b, c);
  };
  /** Implemented in `node_fs_stat_watcher.zig` */
  // interface StatWatcherHandle {
  //   ref();
  //   unref();
  //   close();
  // }
  class StatWatcher extends EventEmitter {
    // _handle: StatWatcherHandle;

    constructor(path, options) {
      super();
      this._handle = doWatchFile(path, options, this.#onChange.bind(this));
    }

    #onChange(curr, prev) {
      this.emit("change", curr, prev);
    }

    // https://github.com/nodejs/node/blob/9f51c55a47702dc6a0ca3569853dd7ba022bf7bb/lib/internal/fs/watchers.js#L259-L263
    start() {}

    stop() {
      this._handle?.close();
      this._handle = null;
    }

    ref() {
      this._handle?.ref();
    }

    unref() {
      this._handle?.unref();
    }
  }

  return StatWatcher;
}

export default {
  StatWatcherPropertyDescriptor: {
    enumerable: true,
    get() {
      return (StatWatcher ??= load());
    },
    set() {},
  },
  watchFile,
  unwatchFile,
};

// TODO: move this entire thing into native code.
// the reason it's not done right now is because there isnt a great way to have multiple
// listeners per StatWatcher with the current implementation in native code. the downside
// of this means we need to do path validation in the js side of things

function unwatchFile(filename, listener) {
  filename = getValidatedPath(filename);

  var stat = statWatchers.get(filename);
  if (!stat) return;
  if (listener) {
    stat.removeListener("change", listener);
    if (stat.listenerCount("change") !== 0) {
      return;
    }
  } else {
    stat.removeAllListeners("change");
  }
  stat.stop();
  statWatchers.delete(filename);
}
