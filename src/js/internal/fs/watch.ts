// fs.watch is lazily loaded so the FSWatcher class is only set up when it is used.
const EventEmitter = require("node:events");
const { basename } = require("node:path");

// The native `node:fs` binding, shared via `internal/fs/binding`.
const fs = require("internal/fs/binding");

// Creates an ignore matcher function from the `ignore` watch option,
// mirroring node lib/internal/fs/watchers.js createIgnoreMatcher.
// string -> glob (patterns without a slash also match the basename),
// RegExp -> exec, function -> called with the filename. Arrays compose.
type Glob = import("bun").Glob;
type Matcher = (filename: string) => boolean;
type WatchListener = (eventType: string, filename: unknown) => void;

function makeGlobMatcher(glob: Glob): Matcher {
  return function matchGlob(filename) {
    return glob.match(filename);
  };
}
function makeGlobOrBasenameMatcher(glob: Glob): Matcher {
  return function matchGlobOrBasename(filename) {
    return glob.match(filename) || glob.match(basename(filename));
  };
}
function makeRegexMatcher(matcher: RegExp): Matcher {
  return function matchRegex(filename) {
    return matcher.exec(filename) !== null;
  };
}

function createIgnoreMatcher(ignore: unknown) {
  if (ignore == null) return null;
  const matchers = $isArray(ignore) ? ignore : [ignore];
  const compiled: Matcher[] = [];

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
      compiled.push(matcher as Matcher);
    } else {
      throw $ERR_INVALID_ARG_TYPE("options.ignore", ["string", "RegExp", "Function"], matcher);
    }
  }

  return function isIgnored(filename: unknown) {
    // With encoding: "buffer" the watcher delivers Buffer filenames; the
    // string/glob matchers (and basename()) need a string.
    if (typeof filename !== "string") filename = String(filename);
    for (const match of compiled) {
      if (match(filename as string)) return true;
    }
    return false;
  };
}

const kFSWatchStart = Symbol("kFSWatchStart");

// Node-compatible whitebox surface: `watcher._handle` is the FSEvent-like handle that
// delegates to the real native watcher. Replacing it with a foreign object makes
// close()/[kFSWatchStart]() fail the same internal assertion as Node.
let closeNativeWatcher: (watcher: FSWatcher) => void;
let closeNativeWatcherWithoutEvent: (watcher: FSWatcher) => void;
let dispatchNativeEvent: (watcher: FSWatcher, eventType: string, filename: unknown) => void;
let refNativeWatcher: (watcher: FSWatcher) => void;
let unrefNativeWatcher: (watcher: FSWatcher) => void;
let isNativeWatcherOpen: (watcher: FSWatcher) => boolean;
let onFSEventChange: (this: FSEvent, status: number, eventType: string, filename: unknown) => void;

let uvErrorMap: Map<number, [code: string, description: string]> | undefined;

// Mirrors node's UVException for the watch syscall:
// "ENOENT: no such file or directory, watch '/path'".
function makeWatchUVException(status: number, filename: unknown) {
  uvErrorMap ??= process.binding("uv").getErrorMap() as Map<number, [code: string, description: string]>;
  const entry = uvErrorMap.$get(status);
  const code = entry ? entry[0] : "UNKNOWN";
  const description = entry ? entry[1] : "unknown error";
  const err: any = new Error(`${code}: ${description}, watch '${filename}'`);
  err.errno = status;
  err.code = code;
  err.syscall = "watch";
  err.path = filename;
  err.filename = filename;
  return err;
}

class FSEvent {
  #owner: FSWatcher;
  // An own function key, as in node, so structured clone refuses a watcher that has a handle: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/watchers.js#L256
  onchange = onFSEventChange;
  constructor(owner: FSWatcher) {
    this.#owner = owner;
  }
  // https://github.com/nodejs/node/blob/v26.3.0/src/fs_event_wrap.cc#L110-L118
  get initialized() {
    return isNativeWatcherOpen(this.#owner);
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

  static {
    // Node's binding calls this. Bun's native watcher reports through FSWatcher#onEvent, so it is here for code that drives the handle itself.
    onFSEventChange = function onchange(status, eventType, filename) {
      const owner = this.#owner;
      if (status < 0) {
        // Node drops the handle here without emitting "close": it closes the raw FSEvent and does not go through FSWatcher.close().
        closeNativeWatcherWithoutEvent(owner);
        owner._handle = null;
        owner.emit("error", makeWatchUVException(status, filename));
        return;
      }
      dispatchNativeEvent(owner, eventType, filename);
    };
  }
}

function assertFSEventHandle(handle: unknown) {
  if (!(handle instanceof FSEvent)) {
    throw $ERR_INTERNAL_ASSERTION("handle must be a FSEvent" + require("internal/shared").kInternalAssertionSuffix);
  }
}

class FSWatcher extends EventEmitter {
  #watcher: $Bindgen.FSWatcher | null | undefined;
  #listener: WatchListener;
  #silentClose = false;
  _handle: FSEvent | null;
  // Node's fifth own key: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/watchers.js#L254
  _ignoreMatcher: ((filename: unknown) => boolean) | null;
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

    this._ignoreMatcher = createIgnoreMatcher(options?.ignore);
    this.#listener = listener;
    try {
      this.#watcher = fs.watch(path, options || {}, this.#onEvent.bind(this));
    } catch (e: any) {
      e.path = path;
      e.filename = path;
      // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/watchers.js#L317
      // Only ENOENT is suppressed, and the watcher is left unstarted rather than
      // reporting the failure. The option defaults to true, so an absent value
      // still throws; any other falsy value suppresses.
      if (options?.throwIfNoEntry !== undefined && !options.throwIfNoEntry && e.code === "ENOENT") {
        this._handle = new FSEvent(this);
        return;
      }
      throw e;
    }
    this._handle = new FSEvent(this);
  }

  #onEvent(eventType: string, filenameOrError: string | Buffer | Error | undefined, fromAbort = false) {
    if (eventType === "close") {
      // #watcher is still set, so the native side closed the watcher (an abort signal or an error) and not a close() of the handle.
      if (this.#watcher != null) {
        this.#watcher = null;
        this._handle = null;
      }
      if (this.#silentClose) return;
      // close on next microtask tick to avoid long-running function calls when
      // we're trying to detach the watcher
      queueMicrotask(() => {
        this.emit("close", filenameOrError);
      });
      return;
    } else if (eventType === "error") {
      if (fromAbort) {
        // An aborted signal closes the watcher; its reason is offered to an
        // 'error' listener if there is one, but is not an unhandled error
        // without one (node emits only 'close' for an abort).
        if (this.listenerCount("error") === 0) return;
      } else if ((filenameOrError as Error).code === "EACCES") {
        // Next.js/watchpack ends up watching paths it does not have access to,
        // which surfaces here as EACCES errors. Rewriting the code to EPERM
        // makes watchpack's error handling ignore the error instead of failing.
        (filenameOrError as Error).code = "EPERM";
      }

      this.emit(eventType, filenameOrError);
    } else {
      if (filenameOrError != null && this._ignoreMatcher?.(filenameOrError)) {
        return;
      }
      this.emit("change", eventType, filenameOrError);
      this.#listener(eventType, filenameOrError);
    }
  }

  close() {
    // A handle dropped by the onchange error path makes close() a no-op, as in node.
    const handle = this._handle;
    if (handle === null) return;
    assertFSEventHandle(handle);
    // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/fs/watchers.js#L346
    if (!handle.initialized) return;
    handle.close();
    this._handle = null;
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
    if (this._handle === null) return;
    assertFSEventHandle(this._handle);
  }

  static {
    // Named function expressions inside the class's static block so they
    // can read the private #watcher field; assigned to module-level lets so
    // callers outside the class can invoke them.
    // Node treats the eventType here as opaque and always emits "change"; it must
    // not reach #onEvent, where "close"/"error" are control signals rather than
    // event names.
    dispatchNativeEvent = function dispatchNativeEvent(watcher, eventType, filename) {
      if (filename != null && watcher._ignoreMatcher?.(filename)) return;
      watcher.emit("change", eventType, filename);
      watcher.#listener(eventType, filename);
    };
    isNativeWatcherOpen = function isNativeWatcherOpen(watcher) {
      return watcher.#watcher != null;
    };
    closeNativeWatcher = function closeNativeWatcher(watcher) {
      // Cleared first: the native close calls #onEvent("close"), which reads #watcher to tell who closed.
      const native = watcher.#watcher;
      watcher.#watcher = null;
      native?.close();
    };
    closeNativeWatcherWithoutEvent = function closeNativeWatcherWithoutEvent(watcher) {
      watcher.#silentClose = true;
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

export default { watch, createIgnoreMatcher };
