// fs.watchFile and fs.unwatchFile are lazily loaded so that the StatWatcher
// machinery is not set up until it is actually used.
const EventEmitter = require("node:events");
const AsyncContextFrame = require("internal/async_context_frame");
const { getValidatedPath, throwIfNullBytesInFileName } = require("internal/validators");

// The native `node:fs` binding, shared via `internal/fs/binding`.
const fs = require("internal/fs/binding");

/** Implemented natively. */
interface StatWatcherHandle {
  ref();
  unref();
  close();
}

function emitStop(self: StatWatcher) {
  self.emit("stop");
}

class StatWatcher extends EventEmitter {
  _handle: StatWatcherHandle | null;

  constructor(path, options) {
    super();
    this._handle = fs.watchFile(path, options, this.#onChange.bind(this));
  }

  #onChange(curr, prev) {
    this.emit("change", curr, prev);
  }

  // https://github.com/nodejs/node/blob/9f51c55a47702dc6a0ca3569853dd7ba022bf7bb/lib/internal/fs/watchers.js#L259-L263
  start() {}

  stop() {
    if (!this._handle) return;

    process.nextTick(emitStop, this);

    this._handle.close();
    this._handle = null;
  }

  ref() {
    this._handle?.ref();
  }

  unref() {
    this._handle?.unref();
  }
}

// This is implemented in JavaScript instead of entirely in native code because there isn't a
// great way to have multiple listeners per StatWatcher with the current implementation in
// native code. The downside of this is that we need to do path validation on the JS side.
//
// One StatWatcher per path and per owner: the realm, or the Bun.ModuleGraph whose code is watching.
// The watcher is the owner's (its context made it, and dispose() closes it), so sharing one between
// owners would let one graph's dispose() silence everybody else's listeners, and keep a disposed
// graph's listener running on a watcher somebody else made.
const realmStatWatchers = new Map();
const graphStatWatchers = new WeakMap<object, Map<string, StatWatcher>>();
function statWatchersOfCaller(): Map<string, StatWatcher> {
  const graph = AsyncContextFrame.current()?.graph;
  if (graph === undefined) return realmStatWatchers;
  let watchers = graphStatWatchers.get(graph);
  if (!watchers) graphStatWatchers.set(graph, (watchers = new Map()));
  return watchers;
}

function watchFile(filename, options, listener) {
  filename = getValidatedPath(filename);

  if (typeof options === "function") {
    listener = options;
    options = {};
  }

  if (typeof listener !== "function") {
    throw $ERR_INVALID_ARG_TYPE("listener", "function", listener);
  }

  const statWatchers = statWatchersOfCaller();
  var stat = statWatchers.get(filename);
  if (!stat) {
    stat = new StatWatcher(filename, options);
    statWatchers.set(filename, stat);
  }
  stat.addListener("change", listener);
  return stat;
}

function unwatchFile(filename, listener) {
  filename = getValidatedPath(filename);

  const statWatchers = statWatchersOfCaller();
  var stat = statWatchers.get(filename);
  if (!stat) return throwIfNullBytesInFileName(filename);
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

export default { watchFile, unwatchFile };
