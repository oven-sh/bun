// `MessagePort`, `BroadcastChannel`, `structuredClone()`, and how objects are transferred.
const idl = require("internal/desktop/web/idl");

const { Event, EventTarget, dictionary, error, expose, internal, need, scope } = idl;
const { MessageChannel: NativeChannel, MessagePort: NativePort, structuredClone: nativeClone } = idl.native;
const { isAnyArrayBuffer } = require("node:util/types");
const noPorts = Object.freeze([]);

const isAnyPort = (value: any) =>
  isPort(value) || (value?.$impl !== undefined && value[Symbol.toStringTag] === "MessagePort");

function portsOf(value: unknown) {
  const ports = idl.sequence(value);
  if (!ports.every(isAnyPort)) throw new TypeError("The provided value is not of type 'MessagePort'.");
  return Object.freeze(ports);
}

function sourceOf(value: any) {
  if (value !== null && !isAnyPort(value) && value?.window !== value)
    throw new TypeError("Invalid source of a message.");
  return value;
}

let messageEvent: (
  type: string,
  data: unknown,
  origin: string,
  source: unknown,
  ports: readonly object[],
  token?: string,
) => MessageEvent;
let senderOf: (event: MessageEvent) => string | undefined;

class MessageEvent extends Event {
  #data: unknown = null;
  #origin = "";
  #sender: string | undefined;
  #lastEventId = "";
  #source: unknown = null;
  #ports: readonly object[] = noPorts;

  constructor(type: string, init: any = undefined) {
    need(arguments.length, 1);
    super(type, init);
    if (init === undefined) return;
    const { data = null, lastEventId = "", origin = "", ports = [], source = null } = dictionary(init);
    this.#data = data;
    this.#lastEventId = `${lastEventId}`;
    this.#origin = idl.usv(origin);
    this.#ports = portsOf(ports);
    this.#source = sourceOf(source);
  }

  static {
    senderOf = event => event.#sender;
    messageEvent = (type, data, origin, source, ports, token) => {
      const event = new MessageEvent(type);
      if (origin !== "") event.#sender = origin === "null" ? "null " + token : origin;
      event.#data = data;
      event.#origin = origin;
      event.#source = source;
      if (ports.length > 0) event.#ports = Object.freeze(ports);
      return event;
    };
  }

  get data() {
    return this.#data;
  }
  get origin() {
    return this.#origin;
  }
  get lastEventId() {
    return this.#lastEventId;
  }
  get source() {
    return this.#source;
  }
  get ports() {
    return this.#ports;
  }

  initMessageEvent(
    type: string,
    bubbles = false,
    cancelable = false,
    data: unknown = null,
    origin = "",
    lastEventId = "",
    source: unknown = null,
    ports: unknown = [],
  ) {
    void this.#data;
    need(arguments.length, 1);
    if (this.eventPhase !== 0) return;
    Event.prototype.initEvent.$call(this, type, bubbles, cancelable);
    this.#data = data;
    this.#origin = idl.usv(origin);
    this.#lastEventId = `${lastEventId}`;
    this.#source = sourceOf(source);
    this.#ports = portsOf(ports);
  }
}
expose(MessageEvent);

// ───────────────────────────── transfer ─────────────────────────────

type Transfer = {
  /** What is cloned in place of the object. */
  record: object;
  /** What is in `record` and has to be moved. */
  moved: object[];
  /** For when nothing can fail any more. */
  detach(): void;
};

const transfers: WeakMap<object, Transfer> = scope.env.transfers;

/** `begin` throws if the object cannot be transferred. */
function transferable(prototype: object, begin: (value: any) => Transfer, serialize?: Function) {
  $putByIdDirectPrivate(prototype as any, "transferrer", begin);
  idl.serializable(prototype, (value, isForStorage) => {
    const transfer = transfers.get(value);
    if (transfer) return transfer.record;
    if (serialize) return serialize(value, isForStorage);
    throw error("DataCloneError", "An object that has to be transferred was not in the list.");
  });
}

function transferrerOf(value: object) {
  if (!isPort(value)) registerStreams();
  for (let at = value; at !== null; at = Object.getPrototypeOf(at)) {
    const found = $getByIdDirectPrivate(at, "transferrer");
    if (found !== undefined) return found;
  }
}

/** The second argument of `postMessage`. */
function transferList(options: any, mayBeSequence = true): object[] {
  if (options == null) return noPorts as any;
  const isSequence = mayBeSequence && $isObject(options) && options[Symbol.iterator] != null;
  const given = isSequence ? options : dictionary(options).transfer;
  const list = given === undefined ? [] : idl.sequence(given);
  if (!list.every(it => $isObject(it))) throw new TypeError("Only objects can be transferred.");
  return list;
}

/** What `send` is given is a pair of the transferred objects and the message. */
function serialize<T>(message: unknown, list: object[], send: (envelope: unknown[], moved: object[]) => T): T {
  if (list.length === 0) return send([list, message], list);
  const own: Transfer[] = [];
  try {
    if (new Set(list).size !== list.length) throw error("DataCloneError", "An object is in the transfer list twice.");
    const moved: object[] = [];
    for (const value of list) {
      const begin = isAnyArrayBuffer(value) || value instanceof NativePort ? undefined : transferrerOf(value);
      if (begin === undefined) moved.push(value);
      else {
        const transfer: Transfer = (begin as any)(value);
        transfers.set(value, transfer);
        own.push(transfer);
        moved.push(...transfer.moved);
      }
    }
    const result = send([list, message], moved);
    for (const transfer of own) transfer.detach();
    return result;
  } finally {
    for (const value of list) transfers.delete(value);
  }
}

const cloneHere = (envelope: unknown[], transfer: object[]): any => nativeClone(envelope, { transfer } as any);

/** `clone` is `cloneHere` of the realm that gets the message. */
function cloneInto(clone: typeof cloneHere, message: unknown, list: object[]): [object[], unknown] {
  if (!$isObject(message) && typeof message !== "symbol" && list.length === 0) return [list, message];
  try {
    return serialize(message, list, clone);
  } catch (thrown: any) {
    const isForeign = clone !== cloneHere && !(thrown instanceof DOMException) && thrown?.name === "DataCloneError";
    throw isForeign ? idl.ownError(thrown) : thrown;
  }
}

function structuredCloneOf(value: unknown, options: any = undefined) {
  need(arguments.length, 1);
  return options === undefined ? nativeClone(value) : cloneInto(cloneHere, value, transferList(options, false))[1];
}

// ───────────────────────────── MessagePort ─────────────────────────────

const adopted = new WeakMap<object, MessagePort>();
const ofStreams = new WeakSet<object>();

/** What a native `message` event has for scripts. */
function received(event: any): [object[], unknown] {
  const { data, ports } = event;
  return [ports.length === 0 ? noPorts : ports.filter(port => !ofStreams.has(port)).map(adopt), data];
}

let isPort: (value: unknown) => boolean;
let entangle: (a: MessagePort, b: MessagePort) => void;
let adopt: (native: any) => MessagePort;
let release: (port: MessagePort) => any;

/** Until one of the two is transferred, they know each other. From then on, there is a native channel in between. */
class MessagePort extends EventTarget {
  #peer: MessagePort | null = null;
  #native: any = null;
  #queue: [object[], unknown][] = [];
  #isStarted = false;
  #isDetached = false;
  #close = () => this.close();

  constructor(key: unknown = undefined) {
    idl.illegal(key);
    super();
  }

  static {
    isPort = value => $isObject(value) && #peer in (value as object);
    entangle = (a, b) => {
      a.#peer = b;
      b.#peer = a;
    };
    adopt = native => {
      let port = adopted.get(native);
      if (port === undefined) {
        adopted.set(native, (port = new MessagePort(internal)));
        port.#use(native);
      }
      return port;
    };
    release = port => {
      const { moved, detach } = port.#beginTransfer();
      detach();
      return moved[0];
    };
    transferable(this.prototype, port => port.#beginTransfer());
    idl.defineHandlers(this.prototype, ["message", "messageerror", "close"]);
    const { get, set } = Object.getOwnPropertyDescriptor(this.prototype, "onmessage")!;
    const { set: setAndStart } = Object.getOwnPropertyDescriptor(
      {
        set onmessage(value: unknown) {
          set!.$call(this, value);
          (this as any).#start();
        },
      },
      "onmessage",
    )!;
    Object.defineProperty(this.prototype, "onmessage", { get, set: setAndStart });
  }

  #use(native: any) {
    this.#native = native;
    scope.cleanups.add(this.#close);
    if (this.#isStarted) this.#listen();
  }

  #listen() {
    const native = this.#native;
    native.onmessage = (event: any) => this.#native === native && idl.runTask(() => this.#deliver(received(event)));
    native.addEventListener("close", () => this.#native === native && idl.runTask(() => idl.fire(this, "close")));
    native.onmessageerror = () =>
      idl.runTask(() => idl.dispatchInTask(this, messageEvent("messageerror", null, "", null, noPorts)));
  }

  #deliver(envelope: [object[], unknown]) {
    idl.dispatchInTask(this, messageEvent("message", envelope[1], "", null, envelope[0].filter(isPort)));
  }

  #deliverNext = () => {
    const next = this.#queue.shift();
    if (next) this.#deliver(next);
  };

  #beginTransfer(): Transfer {
    if (this.#isDetached) throw error("DataCloneError", "The port is already detached.");
    if (this.#native === null) {
      const { port1, port2 } = new NativeChannel();
      for (const [list, message] of this.#queue.splice(0)) {
        serialize(message, list, (envelope, moved) => port2.postMessage(envelope[1], moved as any));
      }
      const peer = this.#peer;
      this.#peer = null;
      this.#use(port1);
      if (peer === null) port2.close();
      else {
        peer.#peer = null;
        peer.#use(port2);
      }
    }
    const native = this.#native;
    return {
      record: { kind: "MessagePort", native },
      moved: [native],
      detach: () => {
        this.#native = null;
        this.#isDetached = true;
        scope.cleanups.delete(this.#close);
      },
    };
  }

  postMessage(message: unknown, options: any = undefined) {
    void this.#peer;
    need(arguments.length, 1);
    const list = transferList(options);
    if (list.includes(this)) throw error("DataCloneError", "A port cannot be transferred through itself.");
    const isDoomed = this.#peer !== null && list.includes(this.#peer);
    if (this.#native !== null) {
      return void serialize(message, list, (_, moved) => this.#native.postMessage(message, moved));
    }
    const envelope = cloneInto(cloneHere, message, list);
    if (isDoomed) return;
    const peer = this.#peer;
    if (peer === null) {
      if (this.#native !== null) this.postMessage(envelope[1], envelope[0]);
      return;
    }
    peer.#queue.push(envelope);
    if (peer.#isStarted) idl.queueTask(peer.#deliverNext);
  }

  #start() {
    if (this.#isStarted) return;
    this.#isStarted = true;
    for (let i = 0; i < this.#queue.length; i++) idl.queueTask(this.#deliverNext);
    if (this.#native !== null) this.#listen();
  }

  start() {
    this.#start();
  }

  close() {
    this.#isDetached = true;
    const peer = this.#peer;
    if (peer !== null) {
      peer.#peer = null;
      idl.queueTask(() => idl.fire(peer, "close"));
    }
    this.#peer = null;
    this.#native?.close();
    this.#native = null;
    this.#queue.length = 0;
    scope.cleanups.delete(this.#close);
  }
}
expose(MessagePort);

class MessageChannel {
  #port1 = new MessagePort(internal);
  #port2 = new MessagePort(internal);

  constructor() {
    entangle(this.#port1, this.#port2);
  }

  get port1() {
    return this.#port1;
  }

  get port2() {
    return this.#port2;
  }
}
expose(MessageChannel);

class BroadcastChannel extends EventTarget {
  #name: string;
  #native: any;
  #close = () => this.close();

  constructor(name: string) {
    need(arguments.length, 1);
    name = `${name}`;
    super();
    this.#name = name;
    const { origin, storageKey } = scope.env;
    const native = (this.#native = new idl.native.BroadcastChannel(`${storageKey}\n${name}`));
    const deliver = (type: string, data: unknown) =>
      idl.runTask(() => this.#native && idl.dispatchInTask(this, messageEvent(type, data, origin, null, noPorts)));
    native.onmessage = (event: any) => deliver("message", event.data);
    native.onmessageerror = () => deliver("messageerror", null);
    scope.cleanups.add(this.#close);
  }

  get name() {
    return this.#name;
  }

  postMessage(message: unknown) {
    const native = this.#native;
    need(arguments.length, 1);
    if (scope.disposed) return;
    if (!native) throw error("InvalidStateError", "The channel is closed.");
    native.postMessage(message);
  }

  close() {
    this.#native?.close();
    this.#native = undefined;
    scope.cleanups.delete(this.#close);
  }
}
idl.defineHandlers(BroadcastChannel.prototype, ["message", "messageerror"]);
expose(BroadcastChannel);

// ───────────────────────────── streams ─────────────────────────────

/** https://streams.spec.whatwg.org/#transferrable-streams */
function post(port: MessagePort, type: string, value?: unknown) {
  port.postMessage({ type, value });
}

function postError(port: MessagePort, reason: unknown) {
  try {
    post(port, "error", reason);
  } catch (thrown) {
    post(port, "error", thrown);
    throw thrown;
  } finally {
    port.close();
  }
}

function readableEnd(port: MessagePort) {
  return new ReadableStream(
    {
      start(controller) {
        (port as any).onmessage = ({ data: { type, value } }: any) => {
          if (type === "chunk") return controller.enqueue(value);
          if (type === "close") controller.close();
          else controller.error(value);
          port.close();
        };
        (port as any).onmessageerror = () => {
          const failure = error("DataCloneError", "A chunk could not be cloned.");
          postError(port, failure);
          controller.error(failure);
        };
      },
      pull: () => post(port, "pull"),
      cancel: reason => postError(port, reason),
    },
    { highWaterMark: 0 },
  );
}

function writableEnd(port: MessagePort) {
  let pulled: PromiseWithResolvers<void> = Promise.withResolvers();
  return new WritableStream({
    start(controller) {
      (port as any).onmessage = ({ data: { type, value } }: any) => {
        if (type === "error") controller.error(value);
        pulled.resolve();
      };
    },
    async write(chunk) {
      await pulled.promise;
      pulled = Promise.withResolvers();
      try {
        post(port, "chunk", chunk);
      } catch (thrown) {
        postError(port, thrown);
        throw thrown;
      }
    },
    close() {
      post(port, "close");
      port.close();
    },
    abort: reason => postError(port, reason),
  });
}

const { pipeTo } = ReadableStream.prototype as any;

function transferStream(kind: string, stream: any, pipe: (port: MessagePort) => Promise<void>): Transfer {
  if (stream.locked) throw error("DataCloneError", "A locked stream cannot be transferred.");
  const { port1, port2 } = new NativeChannel();
  return { record: { kind, native: port2 }, moved: [port2], detach: () => $pokePromiseAsHandled(pipe(adopt(port1))) };
}

const transferReadable = (stream: ReadableStream) =>
  transferStream("ReadableStream", stream, port => pipeTo.$call(stream, writableEnd(port)));
const transferWritable = (stream: WritableStream) =>
  transferStream("WritableStream", stream, port => pipeTo.$call(readableEnd(port), stream));

let knowsStreams = false;

/** Making their prototypes is left to the first transfer. */
function registerStreams() {
  if (knowsStreams) return;
  knowsStreams = true;
  transferable(ReadableStream.prototype, transferReadable);
  transferable(WritableStream.prototype, transferWritable);
  transferable(TransformStream.prototype, ({ readable, writable }) => {
    if (readable.locked || writable.locked) throw error("DataCloneError", "A locked stream cannot be transferred.");
    const ends = [transferReadable(readable), transferWritable(writable)];
    return {
      record: { kind: "TransformStream", native: ends[0].moved[0], other: ends[1].moved[0] },
      moved: ends.flatMap(end => end.moved),
      detach: () => ends.forEach(end => end.detach()),
    };
  });
}

function deserialize({ kind, native, other }: any) {
  const port = adopt(native);
  if (kind === "MessagePort") return port;
  ofStreams.add(native);
  if (other) ofStreams.add(other);
  if (kind === "ReadableStream") return readableEnd(port);
  if (kind === "WritableStream") return writableEnd(port);
  const [readable, writable] = [readableEnd(port), writableEnd(adopt(other))];
  const joined = new TransformStream();
  $pokePromiseAsHandled(pipeTo.$call(joined.readable, writable));
  return Object.defineProperties(joined, { readable: { value: readable } });
}

function postTo(native: any, message: unknown, options: unknown) {
  serialize(message, transferList(options), (_, moved) => native.postMessage(message, moved));
}

/** The messages of a native port become those of `target`. */
function forward(native: any, target: object, isClosed?: () => boolean) {
  const deliver = (type: string, [ports, data]: [object[], unknown]) =>
    isClosed?.() || idl.dispatchInTask(target, messageEvent(type, data, "", null, ports));
  native.onmessage = (event: any) => idl.runTask(() => deliver("message", received(event)));
  native.onmessageerror = () => idl.runTask(() => deliver("messageerror", [[], null]));
}

/** What another realm delivers a message of `window.postMessage()` with. */
const inbox = {
  clone: cloneHere,
  deliver(target: object, [list, data]: [object[], unknown], origin: string, source: unknown, token?: string) {
    idl.runTask(() =>
      idl.dispatchInTask(target, messageEvent("message", data, origin, source, list.filter(isPort), token)),
    );
  },
};

export default {
  BroadcastChannel,
  MessageChannel,
  MessageEvent,
  MessagePort,
  adopt,
  cloneInto,
  deserialize,
  forward,
  /** It is not for scripts. */
  hide: (native: object) => void ofStreams.add(native),
  inbox,
  isPort,
  messageEvent,
  postTo,
  release,
  senderOf: senderOf!,
  serialize,
  structuredClone: Object.defineProperty(structuredCloneOf, "name", { value: "structuredClone" }),
  transferList,
  transferable,
};
