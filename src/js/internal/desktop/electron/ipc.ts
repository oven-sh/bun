const EventEmitter = require("node:events");

class IpcMain extends EventEmitter {
  static observe: ((channel: string) => void) | undefined;
  _invokeHandlers = new Map<string, Function>();

  constructor() {
    super();
    // An `error` message that nobody listens to must not throw.
    this.on("error", () => {});
  }

  handle(channel: string, handler: Function) {
    if (this._invokeHandlers.$has(channel)) throw new Error(`Attempted to register a second handler for '${channel}'`);
    if (!$isCallable(handler)) {
      throw new TypeError(`Expected handler to be a function, but found type '${typeof handler}'`);
    }
    this._invokeHandlers.$set(channel, handler);
    IpcMain.observe?.(channel);
  }

  handleOnce(channel: string, handler: Function) {
    this.handle(channel, (event: unknown, ...args: unknown[]) => {
      this.removeHandler(channel);
      return handler(event, ...args);
    });
  }

  removeHandler(channel: string) {
    this._invokeHandlers.$delete(channel);
  }
}

const kPort = Symbol("port");

class MessagePortMain extends EventEmitter {
  [kPort]: MessagePort;

  constructor(port: MessagePort) {
    super();
    this[kPort] = port;
    port.addEventListener("close", () => this.emit("close"));
  }

  start() {
    const port = this[kPort] as any;
    port.onmessage ??= ({ data, ports }) => this.emit("message", { data, ports: wrapPorts(ports) });
    port.unref();
  }

  close() {
    this[kPort].close();
  }

  postMessage(message: unknown, transfer?: MessagePortMain[]) {
    cloneable(() => this[kPort].postMessage(message, unwrapPorts(transfer)));
  }
}

const wrapPorts = (ports: Iterable<MessagePort>) => Array.from(ports, port => new MessagePortMain(port));

function unwrapPorts(ports: MessagePortMain[] = []) {
  if (!$isArray(ports)) throw new TypeError("transferables must be an array of MessagePorts");
  return ports.map((port, index) => {
    if (!(port instanceof MessagePortMain)) throw new TypeError(`Port at index ${index} is not a valid port`);
    return port[kPort];
  });
}

function cloneable<T>(send: () => T): T {
  try {
    return send();
  } catch (error: any) {
    throw error?.name === "DataCloneError" ? new Error("An object could not be cloned.") : error;
  }
}

class MessageChannelMain {
  port1: MessagePortMain;
  port2: MessagePortMain;

  constructor() {
    const { port1, port2 } = new MessageChannel();
    [this.port1, this.port2] = wrapPorts([port1, port2]);
  }
}

/**
 * Messages with ports, over a channel to another process. A port that is sent stays here, and what arrives at it is
 * passed on to a new port over there.
 */
function carryPorts(
  send: (packet: unknown[]) => void,
  firstId: number,
  receive: (data: unknown, ports: MessagePort[]) => void,
) {
  const carried = new Map<number, MessagePort>();
  let nextId = firstId;

  function carry(id: number, port: any) {
    carried.$set(id, port);
    port.onmessage = ({ data, ports }) => post(id, data, ports);
    port.addEventListener("close", () => carried.$delete(id) && send([id]));
    port.unref();
  }

  function post(target: number, data: unknown, ports: Iterable<MessagePort>) {
    const moved: MessagePort[] = structuredClone([...ports], { transfer: [...ports] });
    const ids = moved.map(() => (nextId += 2));
    send([target, data, ids]);
    moved.forEach((port, index) => carry(ids[index], port));
  }

  return {
    post: (data: unknown, ports: MessagePort[]) => cloneable(() => post(0, data, ports)),
    accept([target, data, ids]: [number, unknown, number[]?]) {
      const port = carried.$get(target);
      if (!ids) return void (carried.$delete(target) && port!.close());
      const ports = ids.map(id => {
        const { port1, port2 } = new MessageChannel();
        carry(id, port1);
        return port2;
      });
      if (target === 0) receive(data, ports);
      else port?.postMessage(data, ports);
    },
    close() {
      for (const port of carried.values()) port.close();
    },
  };
}

export default {
  IpcMain,
  MessageChannelMain,
  MessagePortMain,
  carryPorts,
  cloneable,
  ipcMain: new IpcMain(),
  unwrapPorts,
  wrapPorts,
};
