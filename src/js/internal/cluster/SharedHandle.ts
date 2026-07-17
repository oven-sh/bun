// Port of Node's lib/internal/cluster/shared_handle.js, limited to dgram
// sockets: the primary creates one bound, non-reading handle per key and every
// worker that asks for it receives the same descriptor over IPC.
const { _createSocketHandle } = require("internal/dgram");

export default class SharedHandle {
  key;
  workers = new Map();
  handle = null;
  errno = 0;
  data = undefined;

  constructor(key, address, { port, addressType, fd, flags }) {
    this.key = key;

    const rval = _createSocketHandle(address, port, addressType, fd, flags);
    if (typeof rval === "number") {
      this.errno = rval;
    } else {
      this.handle = rval;
    }
  }

  add(worker, send) {
    $assert(!this.workers.has(worker.id));
    this.workers.set(worker.id, worker);
    send(this.errno, null, this.handle);
  }

  remove(worker) {
    if (!this.workers.has(worker.id)) {
      return false;
    }

    this.workers.delete(worker.id);

    if (this.workers.size !== 0) {
      return false;
    }

    this.handle.close();
    this.handle = null;
    return true;
  }
}
