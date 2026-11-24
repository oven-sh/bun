const EventEmitter = require("node:events");

const channelRef = $bindgen("node_cluster_binding.bind.ts", "channelRef");
const startChannelRef = $bindgen("node_cluster_binding.bind.ts", "startChannelRef");

// https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L559-L599, without the getter `fd`.
// The count and the reference itself are native (src/jsc/channel_ref.rs): the listeners of `process` and the writes
// that are under way are counted there too.
class Control extends EventEmitter {
  // The handle of Bun.spawn() for `subprocess.channel`, null for `process.channel`, and undefined for a child that did
  // not start, which has no channel.
  #subprocess: $Bindgen.Subprocess | null | undefined = undefined;

  constructor(subprocess?: $Bindgen.Subprocess | null) {
    super();
    this.#subprocess = subprocess;
    // Node's `Pipe` holds the event loop of a parent from the start. A channel of Bun.spawn({ ipc }) gets no Control
    // and holds nothing.
    if (subprocess) startChannelRef(subprocess);
  }

  refCounted() {
    if (this.#subprocess !== undefined) channelRef("refCounted", this.#subprocess);
  }

  unrefCounted() {
    if (this.#subprocess !== undefined) channelRef("unrefCounted", this.#subprocess);
  }

  ref() {
    if (this.#subprocess !== undefined) channelRef("ref", this.#subprocess);
  }

  unref() {
    if (this.#subprocess !== undefined) channelRef("unref", this.#subprocess);
  }
}

export default Control;
