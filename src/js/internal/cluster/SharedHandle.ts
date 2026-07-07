const clusterRawBind = $newRustFunction("node_cluster_binding.rs", "clusterRawBind", 4);
const closeRawHandle = $newRustFunction("node_cluster_binding.rs", "clusterCloseHandle", 1);
const validateFd = $newRustFunction("node_cluster_binding.rs", "clusterValidateFd", 1);

// node's lib/internal/cluster/shared_handle.js: the primary binds (never
// listens); every worker that asks gets the same fd (duplicated by
// SCM_RIGHTS) and performs its own listen(2)/recv on it. Bind errors are
// captured once and replayed to each worker.
export default class SharedHandle {
  key;
  workers;
  handle;
  errno;
  sharedOnly;

  constructor(key, address, { port, addressType, fd, flags, sharedOnly }) {
    this.key = key;
    this.workers = new Map();
    this.handle = null;
    this.errno = 0;
    // Set when this handle was created for a TLS worker under SCHED_RR: a
    // later plain-net worker joining the same key must not silently downgrade
    // to SCHED_NONE (primary.ts refuses it symmetrically to the reverse case).
    this.sharedOnly = sharedOnly === true;

    if (typeof fd === "number" && fd >= 0) {
      // Pre-bound fd supplied by the worker's listen({fd}). Gate on the fd
      // being a real socket in *this* process (node's createHandle →
      // guessHandleType does the same); otherwise remove() would close an
      // unrelated primary fd (e.g. stderr for `listen({fd:2})`).
      const err = validateFd(fd);
      if (err !== 0) {
        this.errno = err;
      } else {
        this.handle = { fd, port };
      }
      return;
    }
    const rval = clusterRawBind(addressType, address, typeof port === "number" ? port : 0, flags | 0);
    if (typeof rval === "number") this.errno = rval;
    else {
      this.handle = rval; // { fd, port }
      // A pipe bind created the socket file; keep the path so remove() can
      // unlink it the way node's libuv pipe handle does on close. Abstract
      // sockets (leading NUL) are excluded — uv__pipe_close never stores an
      // unlink path for them.
      if (addressType === -1 && (typeof address !== "string" || address.charCodeAt(0) !== 0)) {
        this.handle.path = address;
      }
    }
  }

  add(worker, send) {
    $assert(this.workers.has(worker.id) === false);
    this.workers.set(worker.id, worker);
    send(this.errno, null, this.handle);
  }

  has(worker) {
    return this.workers.has(worker.id);
  }

  remove(worker) {
    if (!this.workers.has(worker.id)) return false;

    this.workers.delete(worker.id);

    if (this.workers.size !== 0) return false;

    if (this.handle) {
      const { fd, path } = this.handle;
      closeRawHandle(fd);
      if (path) {
        // node: uv__pipe_close unlinks the bound path when the primary's
        // handle closes; without this the next run's bind() EADDRINUSEs on
        // the stale socket file.
        try {
          require("node:fs").unlinkSync(path);
        } catch {}
      }
      this.handle = null;
    }
    return true;
  }
}
