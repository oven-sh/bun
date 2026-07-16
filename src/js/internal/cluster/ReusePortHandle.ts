// Bun cannot pass socket handles from a cluster primary to workers over IPC
// (Node's RoundRobinHandle/SharedHandle need that), so every worker binds its
// own SO_REUSEPORT socket; this class only makes them all agree on one port.
export default class ReusePortHandle {
  key;
  // Every live worker sharing this key, keyed by worker id.
  all;
  // Opaque server data (e.g. TLS session ticket keys); owned by queryServer().
  data;
  address;
  // The port every worker must bind. 0 until a listen(0) key is resolved.
  port;
  // Id of the worker that owes us the resolved port for listen(0), or -1.
  binder;
  // worker id -> `done` callback, queued in arrival order until `port` resolves.
  pending;

  constructor(key, address, { port }) {
    this.key = key;
    this.all = new Map();
    this.data = null;
    this.address = address;
    this.port = port;
    this.binder = -1;
    this.pending = new Map();
  }

  // `done(errno, reply, handle)` answers the worker's queryServer message. The
  // handle argument is always null: never sharing a real handle is what routes
  // the worker into internal/cluster/child.ts's rr() faux-handle path.
  add(worker, done) {
    this.all.set(worker.id, worker);

    if (this.resolved()) return reply(this, done);

    if (this.binder === -1) {
      this.binder = worker.id;
      return reply(this, done);
    }

    this.pending.set(worker.id, done);
  }

  remove(worker) {
    if (!this.all.delete(worker.id)) return false;

    this.pending.delete(worker.id);
    // The worker we were waiting on for the port is gone (exited, or closed
    // its server before it ever listened): hand the job to the next in line.
    if (this.binder === worker.id) {
      this.binder = -1;
      promote(this);
    }

    return this.all.size === 0;
  }

  // Called by primary.ts when a worker that queried this key reports the port
  // it actually bound, which for the listen(0) binder is the kernel's choice.
  onListening(worker, port) {
    if (this.resolved() || worker.id !== this.binder) return;
    this.port = port;
    const pending = this.pending;
    this.pending = new Map();
    pending.forEach(done => reply(this, done));
  }

  // Port 0 means "let the kernel pick" and needs a round trip through the
  // binder; a fixed port or a pipe path (port < 0) is already the answer.
  resolved() {
    return this.port !== 0;
  }
}

function reply(handle, done) {
  // Pipes carry no sockname, matching Node (getsockname is TCP-only there).
  done(0, handle.port >= 0 ? { sockname: { address: handle.address, port: handle.port } } : null, null);
}

function promote(handle) {
  // eslint-disable-next-line node-core/no-array-destructuring
  const [next] = handle.pending;
  if (next === undefined) return;

  const { 0: workerId, 1: done } = next;
  handle.pending.delete(workerId);
  handle.binder = workerId;
  reply(handle, done);
}
