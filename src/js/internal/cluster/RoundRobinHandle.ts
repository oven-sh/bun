const { append, init, isEmpty, peek, remove } = require("internal/linkedlist");
const { kHandle } = require("internal/shared");

let net;

const sendHelper = $newRustFunction("node_cluster_binding.rs", "sendHelperPrimary", 4);
const uvTranslateSysError = $newRustFunction("node_util_binding.rs", "uvTranslateSysError", 1);
const einvalErrorCode = $newRustFunction("node_util_binding.rs", "einvalErrorCode", 0);

const ArrayIsArray = Array.isArray;

const UV_TCP_IPV6ONLY = 1;

export default class RoundRobinHandle {
  key;
  all;
  free;
  handles;
  handle;
  server;
  listening;
  // worker.id -> handle sent in a `newconn` whose ack hasn't arrived yet.
  // If that worker dies first, the ack never comes and the handle would leak
  // (keeping the accepted socket - and the primary's event loop - alive).
  inFlight;

  constructor(key, address, { port, fd, flags, backlog, readableAll, writableAll }) {
    net ??= require("node:net");
    this.key = key;
    this.all = new Map();
    this.free = new Map();
    this.handles = init(Object.create(null));
    this.handle = null;
    this.listening = false;
    this.inFlight = new Map();
    // Accepted sockets start paused (no kernel reads), so the connection's
    // bytes stay in the kernel buffer until the fd is handed to a worker.
    // allowHalfOpen keeps the primary's copy inert when the client sends FIN
    // early: node's primary never reacts to EOF on a pending handle, and the
    // worker that adopts the fd still observes the EOF itself.
    this.server = net.createServer({ pauseOnConnect: true, allowHalfOpen: true }, socket => {
      const handle = makeAcceptedHandle(socket);
      // RST-while-queued closes the fd (pause() does not gate EPOLLERR) and
      // the kernel recycles the number: drop the dead entry so it is not
      // redistributed with a stale fd; if in flight, return worker to rotation.
      socket.once("close", () => {
        remove(handle);
        for (const [id, pending] of this.inFlight) {
          if (pending === handle) {
            this.inFlight.delete(id);
            const worker = this.all.get(id);
            if (worker !== undefined) this.handoff(worker);
            break;
          }
        }
      });
      this.distribute(0, handle);
    });

    if (fd >= 0) this.server.listen({ fd, backlog });
    else if (port >= 0) {
      this.server.listen({
        port,
        host: address,
        // Currently, net module only supports `ipv6Only` option in `flags`.
        ipv6Only: !!(flags & UV_TCP_IPV6ONLY),
        backlog,
      });
    } else
      this.server.listen({
        path: address,
        backlog,
        readableAll,
        writableAll,
      }); // UNIX socket path.
    this.server.once("listening", () => {
      this.listening = true;
      this.handle = this.server._handle;
    });
  }

  add(worker, send) {
    $assert(this.all.has(worker.id) === false);
    this.all.set(worker.id, worker);

    const done = () => {
      // address() returns the pipe path (a string) for UNIX sockets.
      if (this.handle.getsockname && typeof this.server.address() === "object") {
        const out = {};
        this.handle.getsockname(out);
        // TODO(bnoordhuis) Check err.
        send(null, { sockname: out }, null);
      } else {
        send(null, null, null); // UNIX socket.
      }

      this.handoff(worker); // In case there are connections pending.
    };

    if (this.listening) return done();

    // Still busy binding.
    this.server.once("listening", done);
    this.server.once("error", err => {
      // Bun's listen errors carry positive platform errnos; translate to the
      // negative uv-style value the cluster protocol (checkBindError,
      // getSystemErrorName) expects. On Windows the WSA code goes through
      // uv_translate_sys_error so `getSystemErrorName(errno)` matches
      // `err.code` — same as node's send(err.errno, null).
      const raw = typeof err.errno === "number" && err.errno !== 0 ? err.errno : null;
      send(raw != null ? uvTranslateSysError(raw) : einvalErrorCode(), null, null);
    });
  }

  has(worker) {
    return this.all.has(worker.id);
  }

  remove(worker) {
    const existed = this.all.delete(worker.id);

    if (!existed) return false;

    this.free.delete(worker.id);

    // Reclaim a connection whose newconn ack will never arrive.
    const pending = this.inFlight.get(worker.id);
    if (pending !== undefined) {
      this.inFlight.delete(worker.id);
      this.distribute(0, pending);
    }

    if (this.all.size !== 0) return false;

    while (!isEmpty(this.handles)) {
      const handle = peek(this.handles);
      handle.close();
      remove(handle);
    }

    this.server?.close();
    this.server = null;
    this.handle = null;
    return true;
  }

  distribute(err, handle) {
    // If `accept` fails just skip it (handle is undefined)
    if (err) {
      return;
    }
    append(this.handles, handle);
    // eslint-disable-next-line node-core/no-array-destructuring
    const [workerEntry] = this.free; // this.free is a SafeMap

    if (ArrayIsArray(workerEntry)) {
      const { 0: workerId, 1: worker } = workerEntry;
      this.free.delete(workerId);
      this.handoff(worker);
    }
  }

  handoff(worker) {
    if (!this.all.has(worker.id)) {
      return; // Worker is closing (or has closed) the server.
    }

    const handle = peek(this.handles);

    if (handle === null) {
      this.free.set(worker.id, worker); // Add to ready queue again.
      return;
    }

    remove(handle);

    const message = { act: "newconn", key: this.key };

    this.inFlight.set(worker.id, handle);
    const sent = sendHelper(worker.process[kHandle], message, handle, reply => {
      // remove() may have reclaimed the handle when the worker died before
      // acking - or the worker was re-added and a newer handoff is in
      // flight; a stale reply must not touch either handle.
      if (this.inFlight.get(worker.id) !== handle) return;
      this.inFlight.delete(worker.id);
      if (reply.accepted) handle.close();
      else this.distribute(0, handle); // Worker is shutting down. Send to another.

      this.handoff(worker);
    });
    if (sent === null) {
      // Hard send failure (closed channel, dead handle, dup() failure, or
      // Windows export failure): the reply callback will never fire, so
      // reclaim for another worker. `false` = queued, reply IS coming.
      const { id } = worker;
      this.inFlight.delete(id);
      // A dead handle must not be redistributed (it would loop forever).
      if (handle.fd >= 0) this.distribute(0, handle);
      else handle.close();
      // Return the worker to rotation AFTER redistributing, so the
      // distribute() above cannot synchronously pick the same failing
      // worker and spin; a dead worker self-heals via remove(), and a
      // transiently failing one (ENOBUFS) gets retried on a later event.
      if (this.all.has(id)) {
        this.free.set(id, worker);
      }
    }
  }
}

// `.fd` is a live getter: RST-while-queued closes the fd (which the kernel
// recycles), so a snapshotted number could ship an unrelated descriptor.
// sendHelperPrimary rejects fd < 0 and dup()s the value it reads.
function makeAcceptedHandle(socket) {
  return {
    get fd() {
      return socket.destroyed ? -1 : socket._handle.fd;
    },
    close(cb?) {
      socket.destroy();
      if (typeof cb === "function") process.nextTick(cb);
    },
  };
}
