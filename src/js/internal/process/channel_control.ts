const EventEmitter = require("node:events");

const setChannelRef = $bindgen("node_cluster_binding.bind.ts", "setChannelRef");

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L559-L599
class Control extends EventEmitter {
  // The Bun.spawn() handle for `subprocess.channel`, undefined for `process.channel`.
  #subprocess;

  constructor(subprocess?) {
    super();
    this.#subprocess = subprocess;
  }

  refCounted() {
    setChannelRef(true, true, this.#subprocess);
  }

  unrefCounted() {
    setChannelRef(false, true, this.#subprocess);
  }

  ref() {
    setChannelRef(true, false, this.#subprocess);
  }

  unref() {
    setChannelRef(false, false, this.#subprocess);
  }
}

export default Control;
