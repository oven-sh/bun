// fs.watch is lazily loaded so the FSWatcher class is only set up when it is used.
const EventEmitter = require("node:events");

// The native `node:fs` binding, shared via `internal/fs/binding`.
const fs = require("internal/fs/binding");

class FSWatcher extends EventEmitter {
  #watcher;
  #listener;
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

    this.#listener = listener;
    try {
      this.#watcher = fs.watch(path, options || {}, this.#onEvent.bind(this));
    } catch (e: any) {
      e.path = path;
      e.filename = path;
      throw e;
    }
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
      this.emit("change", eventType, filenameOrError);
      this.#listener(eventType, filenameOrError);
    }
  }

  close() {
    this.#watcher?.close();
    this.#watcher = null;
  }

  ref() {
    this.#watcher?.ref();
  }

  unref() {
    this.#watcher?.unref();
  }

  // https://github.com/nodejs/node/blob/9f51c55a47702dc6a0ca3569853dd7ba022bf7bb/lib/internal/fs/watchers.js#L259-L263
  start() {}
}

function watch(path, options, listener) {
  return new FSWatcher(path, options, listener);
}

export default { watch, FSWatcher };
