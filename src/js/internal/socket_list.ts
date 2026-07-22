// Port of Node's lib/internal/socket_list.js: tracks net.Socket instances
// passed over an IPC channel so net.Server.getConnections()/close() can poll
// the receiving process (NODE_SOCKET_* internal messages).
const EventEmitter = require("node:events");

// Matches node's ERR_CHILD_CLOSED_BEFORE_REPLY; the code is deliberately not
// part of the ErrorCode.ts table (see the note in ErrorCode.rs).
function ERR_CHILD_CLOSED_BEFORE_REPLY() {
  const err = new Error("Child closed before reply received");
  err.code = "ERR_CHILD_CLOSED_BEFORE_REPLY";
  return err;
}

const kChannelSockets = Symbol("kChannelSockets");
// Maps a Bun.spawn subprocess to its ChildProcess wrapper (a property on the
// subprocess would transition its structure and break native downcasts).
const channelOwners = new WeakMap();
function setChannelOwner(subprocess, owner) {
  channelOwners.set(subprocess, owner);
}
function getChannelOwner(subprocess) {
  return channelOwners.get(subprocess);
}

function noop() {}

// Node sends these through target._send(msg, undefined, swallowErrors). The
// public send() with a noop callback routes failures to the callback (the
// swallow behavior); without one they surface as an 'error' event, like node.
function sendInternal(target, msg, swallowErrors) {
  if (!target.connected) return;
  target.send(msg, undefined, undefined, swallowErrors ? noop : undefined);
}

// This object keeps track of the sockets that are sent
class SocketListSend extends EventEmitter {
  key;
  child;

  constructor(child, key) {
    super();
    this.key = key;
    this.child = child;
    child.once("exit", () => this.emit("exit", this));
  }

  _request(msg, cmd, swallowErrors, callback) {
    const self = this;

    if (!this.child.connected) return onclose();
    sendInternal(this.child, msg, swallowErrors);

    function onclose() {
      self.child.removeListener("internalMessage", onreply);
      callback(ERR_CHILD_CLOSED_BEFORE_REPLY());
    }

    function onreply(msg) {
      if (!(msg.cmd === cmd && msg.key === self.key)) return;
      self.child.removeListener("disconnect", onclose);
      self.child.removeListener("internalMessage", onreply);

      callback(null, msg);
    }

    this.child.once("disconnect", onclose);
    this.child.on("internalMessage", onreply);
  }

  close(callback) {
    this._request(
      {
        cmd: "NODE_SOCKET_NOTIFY_CLOSE",
        key: this.key,
      },
      "NODE_SOCKET_ALL_CLOSED",
      true,
      callback,
    );
  }

  getConnections(callback) {
    this._request(
      {
        cmd: "NODE_SOCKET_GET_COUNT",
        key: this.key,
      },
      "NODE_SOCKET_COUNT",
      false,
      (err, msg) => {
        if (err) return callback(err);
        callback(null, msg.count);
      },
    );
  }
}

// This object keeps track of the sockets that are received
class SocketListReceive extends EventEmitter {
  connections;
  key;
  child;

  constructor(child, key) {
    super();

    this.connections = 0;
    this.key = key;
    this.child = child;

    function onempty(self) {
      if (!self.child.connected) return;

      sendInternal(
        self.child,
        {
          cmd: "NODE_SOCKET_ALL_CLOSED",
          key: self.key,
        },
        true,
      );
    }

    this.child.on("internalMessage", msg => {
      if (msg.key !== this.key) return;

      if (msg.cmd === "NODE_SOCKET_NOTIFY_CLOSE") {
        // Already empty
        if (this.connections === 0) return onempty(this);

        // Wait for sockets to get closed
        this.once("empty", onempty);
      } else if (msg.cmd === "NODE_SOCKET_GET_COUNT") {
        if (!this.child.connected) return;
        sendInternal(
          this.child,
          {
            cmd: "NODE_SOCKET_COUNT",
            key: this.key,
            count: this.connections,
          },
          false,
        );
      }
    });
  }

  add(obj) {
    this.connections++;

    // Notify the previous owner of the socket about its state change
    obj.socket.once("close", () => {
      this.connections--;

      if (this.connections === 0) this.emit("empty", this);
    });
  }
}

// Node keeps these lists on worker[kChannelHandle].sockets; here they live
// directly on the channel owner (ChildProcess or process) under a symbol.
function getSocketList(type, worker, key) {
  const sockets = (worker[kChannelSockets] ??= { got: { __proto__: null }, send: { __proto__: null } })[type];
  let socketList = sockets[key];
  if (!socketList) {
    const Construct = type === "send" ? SocketListSend : SocketListReceive;
    socketList = sockets[key] = new Construct(worker, key);
  }
  return socketList;
}

export default { SocketListSend, SocketListReceive, getSocketList, kChannelSockets, setChannelOwner, getChannelOwner };
