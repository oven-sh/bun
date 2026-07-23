const EventEmitter = require("node:events");
const Worker = require("internal/cluster/Worker");
const RoundRobinHandle = require("internal/cluster/RoundRobinHandle");
const SharedHandle = require("internal/cluster/SharedHandle");
const path = require("node:path");
const { kHandle } = require("internal/shared");

const sendHelper = $newRustFunction("node_cluster_binding.rs", "sendHelperPrimary", 4);
const onInternalMessage = $newRustFunction("node_cluster_binding.rs", "onInternalMessagePrimary", 3);
const enobufsErrorCode = $newRustFunction("node_util_binding.rs", "enobufsErrorCode", 0);
const einvalErrorCode = $newRustFunction("node_util_binding.rs", "einvalErrorCode", 0);
const uvTranslateSysError = $newRustFunction("node_util_binding.rs", "uvTranslateSysError", 1);

let child_process;
let netForProbe;

const ArrayPrototypeSlice = Array.prototype.slice;
const ObjectValues = Object.values;
const ObjectKeys = Object.keys;

const cluster = new EventEmitter();
const intercom = new EventEmitter();
const SCHED_NONE = 1;
const SCHED_RR = 2;

export default cluster;

const handles = new Map();
cluster.isWorker = false;
cluster.isMaster = true; // Deprecated alias. Must be same as isPrimary.
cluster.isPrimary = true;
cluster.Worker = Worker;
cluster.workers = {};
cluster.settings = {};
cluster.SCHED_NONE = SCHED_NONE; // Leave it to the operating system.
cluster.SCHED_RR = SCHED_RR; // Primary distributes connections.

let ids = 0;
let initialized = false;

// XXX(bnoordhuis) Fold cluster.schedulingPolicy into cluster.settings?
const schedulingPolicyEnv = process.env.NODE_CLUSTER_SCHED_POLICY;
let schedulingPolicy = 0;
if (schedulingPolicyEnv === "rr") schedulingPolicy = SCHED_RR;
else if (schedulingPolicyEnv === "none") schedulingPolicy = SCHED_NONE;
else schedulingPolicy = SCHED_RR;
cluster.schedulingPolicy = schedulingPolicy;

cluster.setupPrimary = function (options) {
  const settings = {
    args: ArrayPrototypeSlice.$call(process.argv, 2),
    exec: process.argv[1],
    execArgv: process.execArgv,
    silent: false,
    ...cluster.settings,
    ...options,
  };

  cluster.settings = settings;

  if (initialized === true) return process.nextTick(setupSettingsNT, settings);

  initialized = true;
  schedulingPolicy = cluster.schedulingPolicy; // Freeze policy.
  if (!(schedulingPolicy === SCHED_NONE || schedulingPolicy === SCHED_RR))
    throw new Error(`Bad cluster.schedulingPolicy: ${schedulingPolicy}`);

  process.nextTick(setupSettingsNT, settings);
};

// Deprecated alias must be same as setupPrimary
cluster.setupMaster = cluster.setupPrimary;

function setupSettingsNT(settings) {
  cluster.emit("setup", settings);
}

function createWorkerProcess(id, env) {
  const workerEnv = { ...process.env, ...env, NODE_UNIQUE_ID: `${id}` };
  const execArgv = [...cluster.settings.execArgv];

  // if (cluster.settings.inspectPort === null) {
  //   throw new ERR_SOCKET_BAD_PORT("Port", null, true);
  // }
  // if (isUsingInspector(cluster.settings.execArgv)) {
  //   ArrayPrototypePush(execArgv, `--inspect-port=${getInspectPort(cluster.settings.inspectPort)}`);
  // }

  child_process ??= require("node:child_process");
  return child_process.fork(cluster.settings.exec, cluster.settings.args, {
    cwd: cluster.settings.cwd,
    env: workerEnv,
    serialization: cluster.settings.serialization,
    silent: cluster.settings.silent,
    windowsHide: cluster.settings.windowsHide,
    execArgv: execArgv,
    stdio: cluster.settings.stdio,
    gid: cluster.settings.gid,
    uid: cluster.settings.uid,
  });
}

function removeWorker(worker) {
  if (!worker) throw new Error("ERR_INTERNAL_ASSERTION");
  delete cluster.workers[worker.id];

  if (ObjectKeys(cluster.workers).length === 0) {
    if (!(handles.size === 0)) throw new Error("Resource leak detected.");
    intercom.emit("disconnect");
  }
}

function removeHandlesForWorker(worker) {
  if (!worker) throw new Error("ERR_INTERNAL_ASSERTION");

  handles.forEach(function removeOneHandle(handle, key) {
    // Worker death drops every claim it held at once; the per-server
    // refcount in ReusePortHandle only matters for orderly close().
    const removed = typeof handle.removeWorker === "function" ? handle.removeWorker(worker) : handle.remove(worker);
    if (removed) handles.delete(key);
  });
}

cluster.fork = function (env) {
  cluster.setupPrimary();
  const id = ++ids;
  const workerProcess = createWorkerProcess(id, env);
  const worker = new Worker({
    id: id,
    process: workerProcess,
  });

  worker.on("message", function (message, handle) {
    cluster.emit("message", this, message, handle);
  });

  // FIXME: throwing an error in this function does not get caught
  // at least in the cases where #handle has become null
  // may be always; don't have time to investigate right now
  worker.process.once("exit", (exitCode, signalCode) => {
    /*
     * Remove the worker from the workers list only
     * if it has disconnected, otherwise we might
     * still want to access it.
     */
    if (!worker.isConnected()) {
      removeHandlesForWorker(worker);
      removeWorker(worker);
    }

    worker.exitedAfterDisconnect = !!worker.exitedAfterDisconnect;
    worker.state = "dead";
    worker.emit("exit", exitCode, signalCode);
    cluster.emit("exit", worker, exitCode, signalCode);
  });

  worker.process.once("disconnect", () => {
    worker.process.channel = null;
    /*
     * Now is a good time to remove the handles
     * associated with this worker because it is
     * not connected to the primary anymore.
     */
    removeHandlesForWorker(worker);

    /*
     * Remove the worker from the workers list only
     * if its process has exited. Otherwise, we might
     * still want to access it.
     */
    if (worker.isDead()) removeWorker(worker);

    worker.exitedAfterDisconnect = !!worker.exitedAfterDisconnect;
    worker.state = "disconnected";
    worker.emit("disconnect");
    cluster.emit("disconnect", worker);
  });

  onInternalMessage(worker.process[kHandle], worker, onmessage);
  // Node's primary receives cluster commands as ordinary 'internalMessage'
  // events. The native hook above only sees internal-framed wire messages,
  // so a cluster command whose '$internal' send option was lost (a user
  // wrapper around process.send that truncates arguments) arrives external
  // and is classified by cmd on the receive side - route it like node does.
  // Limitation: only the act-bearing half is recoverable here; {ack: N}
  // replies resolve per-seq callbacks that live in the native internal-frame
  // queue, which this JS path cannot reach.
  worker.process.on("internalMessage", function forwardExternalClusterMessage(message, handle) {
    if (message !== null && typeof message === "object" && message.cmd === "NODE_CLUSTER") {
      onmessage.$call(worker, message, handle);
    }
  });
  process.nextTick(emitForkNT, worker);
  cluster.workers[worker.id] = worker;
  return worker;
};

function emitForkNT(worker) {
  cluster.emit("fork", worker);
}

cluster.disconnect = function (cb) {
  const workers = ObjectKeys(cluster.workers);

  if (workers.length === 0) {
    process.nextTick(() => intercom.emit("disconnect"));
  } else {
    for (const worker of ObjectValues(cluster.workers)) {
      if (worker.isConnected()) {
        worker.disconnect();
      }
    }
  }

  if (typeof cb === "function") intercom.once("disconnect", cb);
};

const methodMessageMapping = {
  close,
  exitedAfterDisconnect,
  listening,
  online,
  probePort,
  queryServer,
  shareListenFd,
};

function onmessage(message, _handle) {
  const worker = this;

  const fn = methodMessageMapping[message.act];

  if (typeof fn === "function") fn(worker, message);
}

function online(worker) {
  worker.state = "online";
  worker.emit("online");
  cluster.emit("online", worker);
}

function exitedAfterDisconnect(worker, message) {
  worker.exitedAfterDisconnect = true;
  send(worker, { ack: message.seq });
}

function queryServer(worker, message) {
  // Stop processing if worker already disconnecting
  if (worker.exitedAfterDisconnect) return;

  const key =
    `${message.address}:${message.port}:${message.addressType}:${message.fd}` +
    (message.port === 0 ? `:${message.index}` : "");
  const cachedHandle = handles.get(key);
  let handle;
  if (cachedHandle && !cachedHandle.has(worker)) handle = cachedHandle;

  const kSharedOnlyHint =
    "TLS and non-TLS cluster workers cannot share the same address:port under SCHED_RR " +
    "(Bun's TLS accept is native and cannot adopt round-robin connection fds)";
  if (handle !== undefined && message.sharedOnly === true && handle instanceof RoundRobinHandle) {
    send(
      worker,
      { errno: einvalErrorCode(), key, ack: message.seq, data: handle.data, bunHint: kSharedOnlyHint },
      null,
    );
    return;
  }
  if (
    schedulingPolicy === SCHED_RR &&
    handle !== undefined &&
    message.sharedOnly !== true &&
    handle instanceof SharedHandle &&
    handle.sharedOnly &&
    message.addressType !== "udp4" &&
    message.addressType !== "udp6"
  ) {
    send(
      worker,
      { errno: einvalErrorCode(), key, ack: message.seq, data: handle.data, bunHint: kSharedOnlyHint },
      null,
    );
    return;
  }

  if (handle === undefined) {
    let address = message.address;

    // Find shortest path for unix sockets because of the ~100 byte limit
    if (message.port < 0 && typeof address === "string" && process.platform !== "win32") {
      address = path.relative(process.cwd(), address);

      if (message.address.length < address.length) address = message.address;
    }

    // UDP is exempt from round-robin connection balancing for what should
    // be obvious reasons: it's connectionless. There is nothing to send to
    // the workers except raw datagrams and that's pointless.
    if (process.platform === "win32" && (message.addressType === "udp4" || message.addressType === "udp6")) {
      const error = new Error(`write ENOTSUP - cannot share a dgram socket with a worker on Windows`);
      error.code = "ENOTSUP";
      error.syscall = "write";
      worker.emit("error", error);
      return;
    }
    if (
      schedulingPolicy !== SCHED_RR ||
      message.sharedOnly === true ||
      message.addressType === "udp4" ||
      message.addressType === "udp6"
    ) {
      handle = new SharedHandle(key, address, message);
    } else {
      handle = new RoundRobinHandle(key, address, message);
    }

    if (!cachedHandle) handles.set(key, handle);
  }

  if (!handle.data) handle.data = message.data;

  // Set custom server data
  handle.add(worker, (errno, reply, serverHandle) => {
    const data = handles.get(key)?.data;

    if (errno && !cachedHandle) handles.delete(key);

    const sent = send(
      worker,
      {
        errno,
        key,
        ack: message.seq,
        data,
        ...reply,
      },
      serverHandle,
    );
    if (sent === null && serverHandle !== null && serverHandle !== undefined) {
      send(worker, { errno: enobufsErrorCode(), key, ack: message.seq, data }, null);
    }
    if (cachedHandle && handle !== cachedHandle && !errno) handle.remove(worker);
  });
}

// node:http cluster workers self-bind with SO_REUSEPORT, which never collides
// with a foreign process at bind time. The primary arbitrates instead: known
// keys belong to this cluster; new ones get a one-shot test bind.
function destroyProbeConnection(probeConnection) {
  probeConnection.destroy();
}

function onReusePortClaim(worker, key, seq, errno) {
  if (errno) handles.delete(key); // Gives other workers a chance to retry.
  send(worker, { errno, key, ack: seq });
}

class ReusePortHandle {
  key;
  port;
  address;
  workers = new Map();
  errno = 0;
  pending = null;
  server = null;

  constructor(key, message, owned) {
    this.key = key;
    this.port = message.port;
    this.address = message.address ?? null;
    if (!(this.port > 0)) return; // Port 0 is kernel-assigned; nothing can collide.
    if (owned !== undefined) {
      // The port is already claimed by this cluster under an overlapping host
      // key; mirror that claim instead of test-binding against our own
      // workers' REUSEPORT sockets (a plain bind would collide on Linux).
      const ownedPending = owned.pending;
      if (ownedPending) {
        this.pending = [];
        ownedPending.push(this.#onOwnedSettled.bind(this));
      } else {
        this.errno = owned.errno;
      }
      return;
    }
    netForProbe ??= require("node:net");
    this.pending = [];
    // A stray client connecting inside the probe window would otherwise be
    // accepted and never destroyed, blocking server.close() (and with it
    // every parked probePort reply) until that client goes away.
    const server = (this.server = netForProbe.createServer(destroyProbeConnection));
    server.once("error", this.#onProbeError.bind(this));
    server.listen({ port: this.port, host: this.address || undefined }, this.#onProbeListening.bind(this, server));
  }

  #onOwnedSettled(errno) {
    this.errno = errno;
    this.#settle();
  }

  #onProbeError(err) {
    const raw = typeof err.errno === "number" && err.errno !== 0 ? err.errno : null;
    this.errno = raw != null ? uvTranslateSysError(raw) : einvalErrorCode();
    this.#settle();
  }

  #onProbeListening(server) {
    server.close(this.#settle.bind(this));
  }

  #settle() {
    this.server = null;
    const pending = this.pending;
    this.pending = null;
    if (pending) for (const send of pending) send(this.errno);
  }

  add(worker, send) {
    // Refcount per server, not per worker: N http.Servers from one worker on
    // the same port must each hold the claim until their own close.
    this.workers.set(worker.id, (this.workers.get(worker.id) ?? 0) + 1);
    const { pending } = this;
    if (pending) pending.push(send);
    else send(this.errno);
  }

  // Dead workers cannot close their servers one by one: collapse the
  // refcount so a single call drops everything the worker held.
  removeWorker(worker) {
    const { workers } = this;
    const { id } = worker;
    if (workers.has(id)) workers.set(id, 1);
    return this.remove(worker);
  }

  remove(worker) {
    const count = this.workers.get(worker.id);
    if (count === undefined) return this.workers.size === 0;
    if (count > 1) {
      this.workers.set(worker.id, count - 1);
      return false;
    }
    this.workers.delete(worker.id);
    if (this.workers.size !== 0) return false;
    this.server?.close();
    this.server = null;
    if (this.pending !== null) {
      // The close() above suppressed the probe's 'listening' callback, which
      // was #settle()'s only trigger - settle the parked repliers now so no
      // worker's listen() waits forever on a dead probe.
      this.#settle();
    }
    return true;
  }
}

// node:http `listen({fd})` in a worker: the descriptor exists only in the
// primary, so SCM_RIGHTS-dup it to the worker, which adopts it directly
// (accepts are then kernel-distributed across sharers).
function shareListenFd(worker, message) {
  if (worker.exitedAfterDisconnect) return;

  const fd = message.fd;
  if (process.platform === "win32") {
    // Descriptor passing over IPC is not implemented on Windows; reply with
    // the same EINVAL the direct listen({fd}) path reports there.
    send(worker, { errno: einvalErrorCode(), ack: message.seq });
    return;
  }
  if (typeof fd !== "number" || fd < 0) {
    send(worker, { errno: -9 /* UV_EBADF */, ack: message.seq });
    return;
  }
  try {
    // sendHelper dups the descriptor for the wire; null means the dup or
    // serialize failed and no reply reached the worker.
    const sent = send(worker, { errno: 0, ack: message.seq }, { fd });
    if (sent === null) send(worker, { errno: einvalErrorCode(), ack: message.seq });
  } catch {
    // A native send failure must not take down the primary's dispatch loop.
    send(worker, { errno: einvalErrorCode(), ack: message.seq });
  }
}

function hostCoversAll(host) {
  return host == null || host === "" || host === "::" || host === "0.0.0.0";
}

// An existing claim on the same port whose host overlaps the requested one
// (wildcards overlap everything) belongs to this cluster, not a foreigner.
function findOwnReusePort(port, address) {
  for (const handle of handles.values()) {
    if (
      handle instanceof ReusePortHandle &&
      handle.port === port &&
      (hostCoversAll(handle.address) || hostCoversAll(address) || handle.address === address)
    ) {
      return handle;
    }
  }
  return undefined;
}

function probePort(worker, message) {
  // Stop processing if worker already disconnecting
  if (worker.exitedAfterDisconnect) return;

  const key = `${message.address}:${message.port}:${message.addressType}:reuseport`;
  let handle = handles.get(key);

  if (handle === undefined) {
    try {
      handle = new ReusePortHandle(key, message, findOwnReusePort(message.port, message.address ?? null));
    } catch {
      // A malformed probe (an out-of-range port reaching net.Server.listen's
      // synchronous validation, for example) must fail the worker's listen,
      // never unwind the primary's message dispatch.
      send(worker, { errno: einvalErrorCode(), ack: message.seq });
      return;
    }
    handles.set(key, handle);
  }

  // Reply shape mirrors Node v26.3.0 lib/internal/cluster/primary.js
  // queryServer's handle.add callback (errno-first, delete-on-error).
  handle.add(worker, onReusePortClaim.bind(null, worker, key, message.seq));
}

function listening(worker, message) {
  const info = {
    addressType: message.addressType,
    address: message.address,
    port: message.port,
    fd: message.fd,
  };

  worker.state = "listening";
  worker.emit("listening", info);
  cluster.emit("listening", worker, info);
}

// Server in worker is closing, remove from list. The handle may have been
// removed by a prior call to removeHandlesForWorker() so guard against that.
function close(worker, message) {
  const key = message.key;
  const handle = handles.get(key);

  if (handle && handle.remove(worker)) handles.delete(key);
}

function send(worker, message, handle?, cb?) {
  // Node marks every cluster-internal message; workers re-emit these as
  // process 'internalMessage' events keyed on this cmd.
  message.cmd = "NODE_CLUSTER";
  return sendHelper(worker.process[kHandle], message, handle, cb);
}

// Extend generic Worker with methods specific to the primary process.
Worker.prototype.disconnect = function () {
  this.exitedAfterDisconnect = true;
  send(this, { act: "disconnect" });
  this.process.disconnect();
  removeHandlesForWorker(this);
  removeWorker(this);
  return this;
};

Worker.prototype.destroy = function (signo) {
  const proc = this.process;
  const signal = signo || "SIGTERM";

  proc.kill(signal);
};
