var watchNodeFS: typeof import("node:fs").watch;

const EventEmitter = require("node:events");
class FSWatcher extends EventEmitter {
  #watcher;
  #listener;
  constructor(path, options, listener) {
    super();

    if (!watchNodeFS) {
      const nodeFS = Bun.fs();
      watchNodeFS = nodeFS.watch.bind(nodeFS) as any;
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
      this.#watcher = watchNodeFS(path, options || {}, this.#onEvent.bind(this));
    } catch (e) {
      if (!e.message?.startsWith("FileNotFound")) {
        throw e;
      }
      const notFound = new Error(`ENOENT: no such file or directory, watch '${path}'`);
      notFound.code = "ENOENT";
      notFound.errno = -2;
      notFound.path = path;
      notFound.syscall = "watch";
      notFound.filename = path;
      throw notFound;
    }
  }

  #onEvent(eventType, filenameOrError) {
    if (eventType === "error" || eventType === "close") {
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

export default {
  FSWatcher,
};
