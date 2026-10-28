import type { ClusterWorker, SendReply } from "internal/cluster/Worker";

interface RawHandle {
  fd: number;
  port?: number;
  path?: string;
}

/** A bound descriptor, or the error number. */
const clusterRawBind: (
  addressType: number | string,
  address: unknown,
  port: number,
  flags: number,
) => RawHandle | number = $bindgen("node_cluster_binding.bind.ts", "clusterRawBind");
const closeRawHandle: (fd: number) => void = $bindgen("node_cluster_binding.bind.ts", "clusterCloseHandle");
const adoptFd: (fd: number, wantDgram: boolean) => number = $bindgen("node_cluster_binding.bind.ts", "clusterAdoptFd");

export default class SharedHandle {
  key: string;
  workers: Map<number, ClusterWorker>;
  handle: RawHandle | null;
  errno: number;
  data: unknown;
  sharedOnly: boolean;

  constructor(key: string, address, { port, addressType, fd, flags, sharedOnly }) {
    this.key = key;
    this.workers = new Map();
    this.handle = null;
    this.errno = 0;
    this.data = undefined;
    this.sharedOnly = sharedOnly === true;

    if (typeof fd === "number" && fd >= 0) {
      const err = adoptFd(fd, addressType === "udp4" || addressType === "udp6");
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

  add(worker: ClusterWorker, send: SendReply) {
    $assert(!this.workers.has(worker.id));
    this.workers.set(worker.id, worker);
    send(this.errno, null, this.handle);
  }

  has(worker: ClusterWorker) {
    return this.workers.has(worker.id);
  }

  remove(worker: ClusterWorker) {
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
