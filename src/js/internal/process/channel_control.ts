const EventEmitter = require("node:events");

const setChannelRef = $newRustFunction("node_cluster_binding.rs", "setChannelRef", 3);

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L559-L598
class Control extends EventEmitter {
  // The Bun.spawn() handle for `subprocess.channel`, undefined for `process.channel`.
  #subprocess = undefined;

  constructor(subprocess) {
    super();
    this.#subprocess = subprocess;
  }

  refCounted() {
    setChannelRef(this.#subprocess, true, true);
  }

  unrefCounted() {
    setChannelRef(this.#subprocess, false, true);
  }

  ref() {
    setChannelRef(this.#subprocess, true, false);
  }

  unref() {
    setChannelRef(this.#subprocess, false, false);
  }
}

export default Control;
