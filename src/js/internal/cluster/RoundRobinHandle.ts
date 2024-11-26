const { append, init, isEmpty, peek, remove } = require("internal/linkedlist");
const { kHandle } = require("internal/shared");

let net;

const sendHelper = $newZigFunction("node_cluster_binding.zig", "sendHelperPrimary", 4);

const ArrayIsArray = Array.isArray;

const UV_TCP_IPV6ONLY = 1;
const assert_fail = () => {
  throw new Error("ERR_INTERNAL_ASSERTION");
};

export default class RoundRobinHandle {
  key;
  all;
  free;
  handles;
  handle;
  server;

  constructor(key, address, { port, fd, flags, backlog, readableAll, writableAll }) {
    net ??= require("node:net");
    this.key = key;
    this.all = new Map();
    this.free = new Map();
    this.handles = init({ __proto__: null });
    this.handle = null;
    this.server = net.createServer(assert_fail);

    if (fd >= 0) this.server.listen({ fd, backlog });
    else if (port >= 0) {
      this.server.listen({
        port,
        host: address,
        // Currently, net module only supports `ipv6Only` option in `flags`.
        ipv6Only: Boolean(flags & UV_TCP_IPV6ONLY),
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
      this.handle = this.server._handle;
      this.handle.onconnection = (err, handle) => this.distribute(err, handle);
      this.server._handle = null;
      this.server = null;
    });
  }

  add(worker, send) {
    // $assert(this.all.has(worker.id) === false);
    this.all.set(worker.id, worker);

    const done = () => {
      if (this.handle.getsockname) {
        const out = {};
        this.handle.getsockname(out);
        // TODO(bnoordhuis) Check err.
        send(null, { sockname: out }, null);
      } else {
        send(null, null, null); // UNIX socket.
      }

      this.handoff(worker); // In case there are connections pending.
    };

    if (this.server === null) return done();

    // Still busy binding.
    this.server.once("listening", done);
    this.server.once("error", err => {
      send(err.errno, null);
    });
  }

  remove(worker) {
    const existed = this.all.delete(worker.id);

    if (!existed) return false;

    this.free.delete(worker.id);

    if (this.all.size !== 0) return false;

    while (!isEmpty(this.handles)) {
      const handle = peek(this.handles);
      handle.close();
      remove(handle);
    }

    this.handle?.stop(false);
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

    sendHelper(worker.process[kHandle], message, handle, reply => {
      if (reply.accepted) handle.close();
      else this.distribute(0, handle); // Worker is shutting down. Send to another.

      this.handoff(worker);
    });
  }
}
