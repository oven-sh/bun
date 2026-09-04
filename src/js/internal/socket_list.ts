const EventEmitter = require("node:events");

const kChannelSockets = Symbol("kChannelSockets");
const channelOwners = new WeakMap();
function setChannelOwner(subprocess, owner) {
  channelOwners.set(subprocess, owner);
}
function getChannelOwner(subprocess) {
  return channelOwners.get(subprocess);
}

function noop() {}

function sendInternal(target, msg, swallowErrors) {
  if (!target.connected) return;
  target.send(msg, undefined, undefined, swallowErrors ? noop : undefined);
}

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
      callback($ERR_CHILD_CLOSED_BEFORE_REPLY("Child closed before reply received"));
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
        if (this.connections === 0) return onempty(this);

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

    obj.socket.once("close", () => {
      this.connections--;

      if (this.connections === 0) this.emit("empty", this);
    });
  }
}

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
