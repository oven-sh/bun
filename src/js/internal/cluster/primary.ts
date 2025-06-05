const EventEmitter = require("node:events");
const Worker = require("internal/cluster/Worker");
const RoundRobinHandle = require("internal/cluster/RoundRobinHandle");
const path = require("node:path");
const { throwNotImplemented, kHandle } = require("internal/shared");

const sendHelper = $newZigFunction("node_cluster_binding.zig", "sendHelperPrimary", 4);
const onInternalMessage = $newZigFunction("node_cluster_binding.zig", "onInternalMessagePrimary", 3);

let child_process;

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
else if (process.platform === "win32") {
  // // Round-robin doesn't perform well on
  // // Windows due to the way IOCP is wired up.
  // schedulingPolicy = SCHED_NONE;
  // TODO
  schedulingPolicy = SCHED_RR;
} else schedulingPolicy = SCHED_RR;
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

  handles.forEach((handle, key) => {
    if (handle.remove(worker)) handles.delete(key);
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
  queryServer,
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

  const key = `${message.address}:${message.port}:${message.addressType}:` + `${message.fd}:${message.index}`;
  let handle = handles.get(key);

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
    if (schedulingPolicy !== SCHED_RR || message.addressType === "udp4" || message.addressType === "udp6") {
      throwNotImplemented("node:cluster SCHED_NONE");
    } else {
      handle = new RoundRobinHandle(key, address, message);
    }

    handles.set(key, handle);
  }

  if (!handle.data) handle.data = message.data;

  // Set custom server data
  handle.add(worker, (errno, reply, handle) => {
    const { data } = handles.get(key);

    if (errno) handles.delete(key); // Gives other workers a chance to retry.

    send(
      worker,
      {
        errno,
        key,
        ack: message.seq,
        data,
        ...reply,
      },
      handle,
    );
  });
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
