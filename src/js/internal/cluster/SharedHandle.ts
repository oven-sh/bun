const clusterRawBind = $newRustFunction("node_cluster_binding.rs", "clusterRawBind", 4);
const closeRawHandle = $newRustFunction("node_cluster_binding.rs", "clusterCloseHandle", 1);
const validateFd = $newRustFunction("node_cluster_binding.rs", "clusterValidateFd", 1);

export default class SharedHandle {
  key;
  workers;
  handle;
  errno;
  data;
  sharedOnly;

  constructor(key, address, { port, addressType, fd, flags, sharedOnly }) {
    this.key = key;
    this.workers = new Map();
    this.handle = null;
    this.errno = 0;
    this.data = undefined;
    this.sharedOnly = sharedOnly === true;

    if (typeof fd === "number" && fd >= 0) {
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
      this.handle = rval;
      if (addressType === -1 && (typeof address !== "string" || address.charCodeAt(0) !== 0)) {
        this.handle.path = address;
      }
    }
  }

  add(worker, send) {
    $assert(!this.workers.has(worker.id));
    this.workers.set(worker.id, worker);
    send(this.errno, null, this.handle);
  }

  has(worker) {
    return this.workers.has(worker.id);
  }

  remove(worker) {
    const workers = this.workers;
    if (!workers.has(worker.id)) return false;

    workers.delete(worker.id);

    if (workers.size !== 0) return false;

    const handle = this.handle;
    if (handle) {
      const { fd, path } = handle;
      closeRawHandle(fd);
      if (path) {
        try {
          require("node:fs").unlinkSync(path);
        } catch {}
      }
      this.handle = null;
    }
    return true;
  }
}
