// Coordinates the workers that share one `(address, port)` listen key.
//
// Node's primary owns the listening socket and passes accepted handles (RR) or
// the listening handle itself (shared) to workers over the IPC channel. Bun's
// IPC cannot transfer socket handles, so instead every worker binds the port
// itself with SO_REUSEPORT and the kernel distributes incoming connections.
// The primary never accepts connections; this object only keeps Node's
// bookkeeping (which workers share which key) and, for a TCP listen on port 0,
// reserves the concrete port that every worker must agree on.
const UV_EADDRINUSE = -4091;
const UV_TCP_IPV6ONLY = 1;

let net;

export default class ReusePortHandle {
  key;
  all;
  data = null;
  errno = 0;
  // The port workers must bind. For a port-0 key this starts at 0 and becomes
  // the reserved port once `server` is listening.
  port;
  // `{ address, family, port }` reported back to workers (TCP port 0 only).
  sockname = null;
  // The primary's port-0 reservation. It is bound with SO_REUSEPORT so the
  // workers can join its group, and released as soon as a worker is listening
  // (an unreleased reservation would be handed a share of the connections).
  server = null;
  // `add()` callbacks queued while the reservation is still binding.
  pending = null;

  constructor(key, address, { port, fd, flags, backlog }) {
    this.key = key;
    this.all = new Map();
    this.port = port;

    // Pipes, fd listens and explicit ports need no help from the primary: the
    // workers already agree on what to bind.
    if (port !== 0 || fd >= 0) return;

    net ??= require("node:net");
    this.pending = [];
    // A connection can only reach the reservation if something races a
    // port scan against us: the resolved port is not observable outside the
    // primary until a worker reports 'listening', which releases it first.
    const server = (this.server = net.createServer(socket => socket.destroy()));

    server.once("listening", () => {
      this.sockname = server.address();
      this.port = this.sockname.port;
      this.flush();
    });
    server.once("error", err => {
      this.errno = err.errno || UV_EADDRINUSE;
      this.server = null;
      this.flush();
    });
    server.listen({
      port: 0,
      host: address,
      ipv6Only: !!(flags & UV_TCP_IPV6ONLY),
      backlog,
      reusePort: true,
    });
  }

  flush() {
    const pending = this.pending;
    this.pending = null;
    for (const done of pending) done();
  }

  add(worker, send) {
    this.all.set(worker.id, worker);

    const done = () => {
      const { errno, sockname } = this;
      if (errno) return send(errno, null);
      send(null, sockname === null ? null : { sockname }, null);
    };

    const { pending } = this;
    if (pending !== null) pending.push(done);
    else done();
  }

  remove(worker) {
    const existed = this.all.delete(worker.id);

    if (!existed) return false;
    if (this.all.size !== 0) return false;

    this.release();
    return true;
  }

  // Called for every 'listening' a worker reports: once any worker is bound to
  // our reserved port, the reservation has done its job. Nothing can be bound
  // to it before the reservation resolves (`sockname` still null) and a server
  // that was closed inside its own 'listening' callback reports port 0, so
  // neither may release it.
  onWorkerListening(port) {
    if (this.server !== null && this.sockname !== null && port === this.port) this.release();
  }

  release() {
    const server = this.server;
    if (server === null) return;
    this.server = null;
    server.close();
  }
}
