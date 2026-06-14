const clusterRawBind = $newZigFunction("node_cluster_binding.zig", "clusterRawBind", 4);
const closeRawHandle = $newZigFunction("node_cluster_binding.zig", "clusterCloseHandle", 1);

// node's lib/internal/cluster/shared_handle.js: the primary binds (never
// listens); every worker that asks gets the same fd (duplicated by
// SCM_RIGHTS) and performs its own listen(2)/recv on it. Bind errors are
// captured once and replayed to each worker.
export default class SharedHandle {
  key;
  workers;
  handle;
  errno;

  constructor(key, address, { port, addressType, fd, flags }) {
    this.key = key;
    this.workers = new Map();
    this.handle = null;
    this.errno = 0;

    if (typeof fd === "number" && fd >= 0) {
      // Pre-bound fd supplied by the worker's listen({fd}).
      this.handle = { fd, port };
      return;
    }
    const rval = clusterRawBind(addressType, address, typeof port === "number" ? port : 0, flags | 0);
    if (typeof rval === "number") this.errno = rval;
    else {
      this.handle = rval; // { fd, port }
      // A pipe bind created the socket file; keep the path so remove() can
      // unlink it the way node's libuv pipe handle does on close.
      if (addressType === -1) this.handle.path = address;
    }
  }

  add(worker, send) {
    // $assert(this.workers.has(worker.id) === false);
    this.workers.set(worker.id, worker);
    send(this.errno, null, this.handle);
  }

  remove(worker) {
    if (!this.workers.has(worker.id)) return false;

    this.workers.delete(worker.id);

    if (this.workers.size !== 0) return false;

    if (this.handle) {
      closeRawHandle(this.handle.fd);
      if (this.handle.path) {
        // node: uv__pipe_close unlinks the bound path when the primary's
        // handle closes; without this the next run's bind() EADDRINUSEs on
        // the stale socket file.
        try {
          require("node:fs").unlinkSync(this.handle.path);
        } catch {}
      }
      this.handle = null;
    }
    return true;
  }
}
