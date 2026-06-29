const EventEmitter = require("node:events");
const Worker = require("internal/cluster/Worker");
const path = require("node:path");
const { owner_symbol } = require("internal/shared");

const sendHelper = $newRustFunction("node_cluster_binding.rs", "sendHelperChild", 3);
const onInternalMessage = $newRustFunction("node_cluster_binding.rs", "onInternalMessageChild", 2);

const FunctionPrototype = Function.prototype;
const ArrayPrototypeJoin = Array.prototype.join;
const ObjectAssign = Object.assign;

const cluster = new EventEmitter();
const handles = new Map();
const indexes = new Map();
const noop = FunctionPrototype;
const kNoFailure = 0;

export default cluster;

cluster.isWorker = true;
cluster.isMaster = false; // Deprecated alias. Must be same as isPrimary.
cluster.isPrimary = false;
cluster.worker = null;
cluster.Worker = Worker;

cluster._setupWorker = function () {
  const worker = new Worker({
    id: +process.env.NODE_UNIQUE_ID | 0,
    process: process,
    state: "online",
  });

  cluster.worker = worker;

  // make sure the process.once("disconnect") doesn't count as a ref
  // before calling, check if the channel is refd. if it isn't, then unref it after calling process.once();
  $newRustFunction("node_cluster_binding.rs", "channelIgnoreOneDisconnectEventListener", 0)();
  process.once("disconnect", () => {
    process.channel = null;
    worker.emit("disconnect");

    if (!worker.exitedAfterDisconnect) {
      // Unexpected disconnect, primary exited, or some such nastiness, so
      // worker exits immediately.
      process.exit(kNoFailure);
    }
  });

  onInternalMessage(worker, onmessage);
  send({ act: "online" });

  function onmessage(message) {
    if (message.act === "disconnect") worker._disconnect(true);
  }
};

// `obj` is a net#Server or a dgram#Socket object.
cluster._getServer = function (obj, options, cb) {
  let address = options.address;

  // Resolve unix socket paths to absolute paths
  if (options.port < 0 && typeof address === "string" && process.platform !== "win32") address = path.resolve(address);

  const indexesKey = ArrayPrototypeJoin.$call([address, options.port, options.addressType, options.fd], ":");

  let indexSet = indexes.get(indexesKey);

  if (indexSet === undefined) {
    indexSet = { nextIndex: 0, set: new Set() };
    indexes.set(indexesKey, indexSet);
  }
  const index = indexSet.nextIndex++;
  indexSet.set.add(index);

  const message = {
    act: "queryServer",
    index,
    data: null,
    ...options,
  };

  message.address = address;

  // Set custom data on handle (i.e. tls tickets key)
  if (obj._getServerData) message.data = obj._getServerData();

  send(message, (reply, handle) => {
    if (typeof obj._setServerData === "function") obj._setServerData(reply.data);

    if (handle) {
      // Shared listen socket
      shared(reply, { handle, indexesKey, index }, cb);
    } else {
      // Round-robin.
      rr(reply, { indexesKey, index }, cb);
    }
  });

  obj.once("listening", () => {
    // short-lived sockets might have been closed
    if (!indexes.has(indexesKey)) {
      return;
    }
    cluster.worker.state = "listening";
    const address = obj.address();
    message.act = "listening";
    message.port = (address && address.port) || options.port;
    send(message);
  });
};

function removeIndexesKey(indexesKey, index) {
  const indexSet = indexes.get(indexesKey);
  if (!indexSet) {
    return;
  }

  indexSet.set.delete(index);
  if (indexSet.set.size === 0) {
    indexes.delete(indexesKey);
  }
}

// Shared listen socket.
function shared(message, { handle, indexesKey, index }, cb) {
  const key = message.key;
  // Monkey-patch the close() method so we can keep track of when it's
  // closed. Avoids resource leaks when the handle is short-lived.
  const close = handle.close;

  handle.close = function () {
    send({ act: "close", key });
    handles.delete(key);
    removeIndexesKey(indexesKey, index);
    return close.$apply(handle, arguments);
  };
  $assert(handles.has(key) === false);
  handles.set(key, handle);
  cb(message.errno, handle);
}

// Bookkeeping handle for a server whose port the primary coordinates. Unlike
// Node's, it is not the server's `_handle`: the worker really listens (with
// SO_REUSEPORT) and that real handle refs the event loop, so `ref`/`unref`
// need no setInterval stand-in here.
function rr(message, { indexesKey, index }, cb) {
  const errno = message.errno;
  if (errno) return cb(errno, null);

  let key = message.key;

  function listen(_backlog) {
    return 0;
  }

  function close() {
    if (key === undefined) return;
    // If the handle is the last handle in process,
    // the parent process will delete the handle when worker process exits.
    // So it is ok if the close message get lost.
    // See the comments of https://github.com/nodejs/node/pull/46161
    send({ act: "close", key });
    handles.delete(key);
    removeIndexesKey(indexesKey, index);
    key = undefined;
  }

  function getsockname(out) {
    if (key) ObjectAssign(out, message.sockname);

    return 0;
  }

  // Sent by net.Server the moment it really binds (before its 'listening'
  // event) so the primary can release the port it reserved for this key.
  function bound() {
    if (key === undefined) return;
    send({ act: "bound", key });
  }

  const handle = { close, listen, ref: noop, unref: noop };
  if (message.sockname) {
    // TCP handles only; sockname is present exactly when the primary holds a
    // port-0 reservation for this key.
    handle.getsockname = getsockname;
    handle.bound = bound;
  }

  $assert(handles.has(key) === false);
  handles.set(key, handle);
  cb(0, handle);
}

function send(message, cb?) {
  return sendHelper(message, null, cb);
}

// Extend generic Worker with methods specific to worker processes.
Worker.prototype.disconnect = function () {
  if (this.state !== "disconnecting" && this.state !== "destroying") {
    this.state = "disconnecting";
    this._disconnect();
  }

  return this;
};

Worker.prototype._disconnect = function (this: typeof Worker, primaryInitiated?) {
  this.exitedAfterDisconnect = true;
  let waitingCount = 1;

  function checkWaitingCount() {
    waitingCount--;

    if (waitingCount === 0) {
      // If disconnect is worker initiated, wait for ack to be sure
      // exitedAfterDisconnect is properly set in the primary, otherwise, if
      // it's primary initiated there's no need to send the
      // exitedAfterDisconnect message
      if (primaryInitiated) {
        process.disconnect();
      } else {
        send({ act: "exitedAfterDisconnect" }, () => process.disconnect());
      }
    }
  }

  handles.forEach(handle => {
    waitingCount++;

    if (handle[owner_symbol]) handle[owner_symbol].close(checkWaitingCount);
    else handle.close(checkWaitingCount);
  });

  handles.clear();
  checkWaitingCount();
};

Worker.prototype.destroy = function () {
  if (this.state === "destroying") return;

  this.exitedAfterDisconnect = true;
  if (!this.isConnected()) {
    process.exit(kNoFailure);
  } else {
    this.state = "destroying";
    send({ act: "exitedAfterDisconnect" }, () => process.disconnect());
    process.once("disconnect", () => process.exit(kNoFailure));
  }
};
