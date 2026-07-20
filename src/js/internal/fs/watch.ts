// fs.watch is lazily loaded so the FSWatcher class is only set up when it is used.
const EventEmitter = require("node:events");
const { basename } = require("node:path");

// The native `node:fs` binding, shared via `internal/fs/binding`.
const fs = require("internal/fs/binding");

// Creates an ignore matcher function from the `ignore` watch option,
// mirroring node lib/internal/fs/watchers.js createIgnoreMatcher.
// string -> glob (patterns without a slash also match the basename),
// RegExp -> exec, function -> called with the filename. Arrays compose.
function makeGlobMatcher(glob) {
  return function matchGlob(filename) {
    return glob.match(filename);
  };
}
function makeGlobOrBasenameMatcher(glob) {
  return function matchGlobOrBasename(filename) {
    return glob.match(filename) || glob.match(basename(filename));
  };
}
function makeRegexMatcher(matcher) {
  return function matchRegex(filename) {
    return matcher.exec(filename) !== null;
  };
}

function createIgnoreMatcher(ignore) {
  if (ignore == null) return null;
  const matchers = $isArray(ignore) ? ignore : [ignore];
  const compiled: Array<(filename: string) => boolean> = [];

  for (const matcher of matchers) {
    if (typeof matcher === "string") {
      if (matcher.length === 0) {
        throw $ERR_INVALID_ARG_VALUE("options.ignore", matcher, "must not be empty");
      }
      const glob = new Bun.Glob(matcher);
      if (matcher.includes("/")) {
        compiled.push(makeGlobMatcher(glob));
      } else {
        // matchBase: patterns without slashes match against the basename
        compiled.push(makeGlobOrBasenameMatcher(glob));
      }
    } else if (matcher instanceof RegExp) {
      compiled.push(makeRegexMatcher(matcher));
    } else if (typeof matcher === "function") {
      compiled.push(matcher);
    } else {
      throw $ERR_INVALID_ARG_TYPE("options.ignore", ["string", "RegExp", "Function"], matcher);
    }
  }

  return function isIgnored(filename) {
    // With encoding: "buffer" the watcher delivers Buffer filenames; the
    // string/glob matchers (and basename()) need a string.
    if (typeof filename !== "string") filename = String(filename);
    for (const match of compiled) {
      if (match(filename)) return true;
    }
    return false;
  };
}

const kFSWatchStart = Symbol("kFSWatchStart");

// Node-compatible whitebox surface: `watcher._handle` is the FSEvent-like handle that
// delegates to the real native watcher. Replacing it with a foreign object makes
// close()/[kFSWatchStart]() fail the same internal assertion as Node.
let closeNativeWatcher: (watcher: FSWatcher) => void;
let refNativeWatcher: (watcher: FSWatcher) => void;
let unrefNativeWatcher: (watcher: FSWatcher) => void;

class FSEvent {
  #owner;
  constructor(owner) {
    this.#owner = owner;
  }
  close() {
    closeNativeWatcher(this.#owner);
  }
  ref() {
    refNativeWatcher(this.#owner);
  }
  unref() {
    unrefNativeWatcher(this.#owner);
  }
}

function assertFSEventHandle(handle) {
  if (!(handle instanceof FSEvent)) {
    throw $ERR_INTERNAL_ASSERTION(
      "handle must be a FSEvent\n" +
        "This is caused by either a bug in Node.js or incorrect usage of Node.js internals.\n" +
        "Please open an issue with this stack trace at https://github.com/nodejs/node/issues\n",
    );
  }
}

class FSWatcher extends EventEmitter {
  #watcher;
  #listener;
  #ignoreMatcher;
  _handle;
  constructor(path, options, listener) {
    super();

    if (path instanceof URL) {
      path = Bun.fileURLToPath(path);
    } else if (typeof path === "string" && path.startsWith("file:")) {
      path = Bun.fileURLToPath(path);
    }

    if (typeof options === "function") {
      listener = options;
      options = {};
    } else if (typeof options === "string") {
      options = { encoding: options };
    }

    if (typeof listener !== "function") {
      listener = () => {};
    }

    this.#ignoreMatcher = createIgnoreMatcher(options?.ignore);
    this.#listener = listener;
    try {
      this.#watcher = fs.watch(path, options || {}, this.#onEvent.bind(this));
    } catch (e: any) {
      e.path = path;
      e.filename = path;
      throw e;
    }
    this._handle = new FSEvent(this);
  }

  #onEvent(eventType, filenameOrError) {
    if (eventType === "close") {
      // close on next microtask tick to avoid long-running function calls when
      // we're trying to detach the watcher
      queueMicrotask(() => {
        this.emit("close", filenameOrError);
      });
      return;
    } else if (eventType === "error") {
      // Next.js/watchpack ends up watching paths it does not have access to,
      // which surfaces here as EACCES errors. Rewriting the code to EPERM
      // makes watchpack's error handling ignore the error instead of failing.
      if (filenameOrError.code === "EACCES") filenameOrError.code = "EPERM";

      this.emit(eventType, filenameOrError);
    } else {
      if (filenameOrError != null && this.#ignoreMatcher?.(filenameOrError)) {
        return;
      }
      this.emit("change", eventType, filenameOrError);
      this.#listener(eventType, filenameOrError);
    }
  }

  close() {
    assertFSEventHandle(this._handle);
    this._handle.close();
  }

  ref() {
    // like node, honour a replaced _handle and support chaining
    const handle = this._handle;
    if (handle) handle.ref();
    return this;
  }

  unref() {
    const handle = this._handle;
    if (handle) handle.unref();
    return this;
  }

  // https://github.com/nodejs/node/blob/9f51c55a47702dc6a0ca3569853dd7ba022bf7bb/lib/internal/fs/watchers.js#L259-L263
  start() {}

  [kFSWatchStart]() {
    assertFSEventHandle(this._handle);
  }

  static {
    // Named function expressions inside the class's static block so they
    // can read the private #watcher field; assigned to module-level lets so
    // callers outside the class can invoke them.
    closeNativeWatcher = function closeNativeWatcher(watcher) {
      watcher.#watcher?.close();
      watcher.#watcher = null;
    };
    refNativeWatcher = function refNativeWatcher(watcher) {
      watcher.#watcher?.ref();
    };
    unrefNativeWatcher = function unrefNativeWatcher(watcher) {
      watcher.#watcher?.unref();
    };
  }
}

function watch(path, options, listener) {
  return new FSWatcher(path, options, listener);
}

export default { watch, FSWatcher, createIgnoreMatcher };
