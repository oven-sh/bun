// Hardcoded module "node:diagnostics_channel"
// Reference: https://github.com/nodejs/node/blob/v26.12.1/lib/diagnostics_channel.js

const { validateFunction } = require("internal/validators");
const { builtinChannels, reportUncaughtException } = require("internal/shared");

/** Reacts to a promise and leaves it as handled or unhandled as it was. False if `value` is none, or its class overrides `then`. */
const observePromise: (value: unknown, then: Traced, onFulfilled: Reaction, onRejected: Reaction) => boolean =
  $newCppFunction("NodeDiagnosticsChannel.cpp", "jsObservePromise", 4);
/** Hands native code the function to publish through. See DiagnosticsHook.h. */
const setHook: (name: string, hook: Function | undefined) => void = $newCppFunction(
  "NodeDiagnosticsChannel.cpp",
  "jsSetDiagnosticsHook",
  2,
);

const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ArrayPrototypeUnshift = Array.prototype.unshift;
const ErrorCaptureStackTrace = Error.captureStackTrace;
const FinalizationRegistryPrototypeRegister = FinalizationRegistry.prototype.register;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectIs = Object.is;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const SafeError = Error;
const SafeWeakRef = WeakRef;
const SymbolDispose: typeof Symbol.dispose = Symbol.dispose;
const SymbolHasInstance = Symbol.hasInstance;
const WeakRefPrototypeDeref = WeakRef.prototype.deref;

type ChannelName = string | symbol;
type Subscription = (message: unknown, name: ChannelName) => void;
type Transform = (data: unknown) => unknown;
interface Store {
  getStore(): unknown;
  enterWith(context: unknown): void;
  withScope?(context: unknown): Disposable;
}
type Stores = Map<Store, Transform | undefined>;
type Traced = (...args: any[]) => unknown;
type Reaction = (value: unknown) => unknown;
/** One object: `markActive` and `maybeMarkInactive` move it from one prototype to the other. */
type AnyChannel = Channel | ActiveChannel;

// An entry can't go when the last subscriber does: whoever holds the channel has to get the same one for its name.
const channels = new $Map<ChannelName, WeakRef<AnyChannel>>();
// Node counts references by name, which loses a subscription once the name leads to another channel.
const activeChannels = new $Map<AnyChannel, true>();
const finalizers = new FinalizationRegistry<ChannelName>(name => {
  // This runs some time after the collection: the name may have a new channel.
  if (findChannel(name) === undefined) channels.$delete(name);
});

function findChannel(name: ChannelName): AnyChannel | undefined {
  const reference = channels.$get(name);
  return reference === undefined ? undefined : WeakRefPrototypeDeref.$call(reference);
}

function findActiveChannel(name: ChannelName) {
  const channel = findChannel(name);
  return channel !== undefined && activeChannels.$has(channel) ? (channel as ActiveChannel) : undefined;
}

function markActive(channel: AnyChannel) {
  ObjectSetPrototypeOf(channel, ActiveChannel.prototype);
  channel._subscribers = [];
  channel._stores = new $Map();
  activeChannels.$set(channel, true);
  try {
    link(channel.name);
  } catch (error) {
    maybeMarkInactive(channel);
    throw error;
  }
}

function maybeMarkInactive(channel: AnyChannel) {
  // When there are no more active subscribers or bound, restore to fast prototype.
  if (!channel._subscribers!.length && !channel._stores!.$size) {
    ObjectSetPrototypeOf(channel, Channel.prototype);
    channel._subscribers = undefined;
    channel._stores = undefined;
    activeChannels.$delete(channel);
    link(channel.name);
  }
}

function reportOnNextTick(error: unknown) {
  process.nextTick(reportUncaughtException, error);
}

function aggregate(inner: unknown, outer: unknown) {
  return require("internal/errors").aggregateTwoErrors(inner as Error, outer as Error);
}

const kNoScopes: Disposable[] = [];

// Node throws without withScope(). dd-trace up to 5.35 binds an object of its own that lacks it.
function enterStore(store: Store, context: unknown): Disposable {
  if (store.withScope) return store.withScope(context);
  const previous = store.getStore();
  store.enterWith(context);
  return { [SymbolDispose]: () => store.enterWith(previous) };
}

function enterBoundStores(stores: Stores, data: unknown, scopes: Disposable[]) {
  stores.$forEach((transform, store) => {
    let context = data;
    if (transform) {
      try {
        context = transform(data);
      } catch (error) {
        reportOnNextTick(error);
        return;
      }
    }
    $arrayPush(scopes, enterStore(store, context));
  });
}

/** Enters the stores and publishes. If that throws, no store stays entered. */
function enterStores(channel: AnyChannel, data: unknown) {
  const stores = channel._stores;
  const scopes = stores?.$size ? [] : kNoScopes;
  try {
    if (scopes !== kNoScopes) enterBoundStores(stores!, data, scopes);
    channel.publish(data);
  } catch (error) {
    exitStores(scopes, true, error);
  }
  return scopes;
}

/** Throws `error` if `failed`, together with whatever the scopes throw. */
function exitStores(scopes: Disposable[], failed: boolean, error?: unknown) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    try {
      scopes[i]?.[SymbolDispose]();
    } catch (thrown) {
      error = failed ? aggregate(thrown, error) : thrown;
      failed = true;
    }
  }

  if (failed) throw error;
}

class RunStoresScope {
  #scopes: Disposable[];

  constructor(activeChannel: ActiveChannel, data: unknown) {
    this.#scopes = enterStores(activeChannel, data);
  }

  [SymbolDispose]() {
    const scopes = this.#scopes;
    this.#scopes = kNoScopes;
    exitStores(scopes, false);
  }
}

class ActiveChannel {
  declare _subscribers: Subscription[] | undefined;
  declare _stores: Stores | undefined;
  declare name: ChannelName;

  subscribe(subscription: Subscription) {
    validateFunction(subscription, "subscription");

    this._subscribers = ArrayPrototypeSlice.$call(this._subscribers);
    ArrayPrototypePush.$call(this._subscribers, subscription);
  }

  unsubscribe(subscription: Subscription) {
    const index = ArrayPrototypeIndexOf.$call(this._subscribers, subscription);
    if (index === -1) return false;

    const subscribers = ArrayPrototypeSlice.$call(this._subscribers);
    ArrayPrototypeSplice.$call(subscribers, index, 1);
    this._subscribers = subscribers;

    maybeMarkInactive(this);

    return true;
  }

  bindStore(store: Store, transform?: Transform) {
    this._stores!.$set(store, transform);
  }

  unbindStore(store: Store) {
    if (!this._stores!.$delete(store)) {
      return false;
    }

    maybeMarkInactive(this);

    return true;
  }

  get hasSubscribers() {
    return true;
  }

  publish(data: unknown) {
    const subscribers = this._subscribers;
    for (let i = 0; i < (subscribers?.length || 0); i++) {
      try {
        const onMessage = subscribers![i];
        onMessage(data, this.name);
      } catch (error) {
        reportOnNextTick(error);
      }
    }
  }

  withStoreScope(data: unknown): Disposable {
    return new RunStoresScope(this, data);
  }

  runStores(data: unknown, fn: Traced, thisArg?: unknown, ...args: unknown[]) {
    const scopes = enterStores(this, data);
    let result;
    try {
      result = fn.$apply(thisArg, args);
    } catch (error) {
      exitStores(scopes, true, error);
    }
    exitStores(scopes, false);
    return result;
  }
}

class Channel {
  _subscribers: Subscription[] | undefined;
  _stores: Stores | undefined;
  name: ChannelName;
  _index: undefined;

  constructor(name: ChannelName) {
    this._subscribers = undefined;
    this._stores = undefined;
    this.name = name;
    this._index = undefined;

    FinalizationRegistryPrototypeRegister.$call(finalizers, this, name);
    channels.$set(name, new SafeWeakRef(this));
  }

  static [SymbolHasInstance](instance: unknown) {
    if (instance == null) return false;
    const prototype = ObjectGetPrototypeOf(instance);
    return prototype === Channel.prototype || prototype === ActiveChannel.prototype;
  }

  subscribe(subscription: Subscription) {
    validateFunction(subscription, "subscription");
    markActive(this);
    this.subscribe(subscription);
  }

  unsubscribe() {
    return false;
  }

  bindStore(store: Store, transform?: Transform) {
    markActive(this);
    this.bindStore(store, transform);
  }

  unbindStore() {
    return false;
  }

  get hasSubscribers() {
    return false;
  }

  publish() {}

  runStores(data: unknown, fn: Traced, thisArg?: unknown, ...args: unknown[]) {
    return fn.$apply(thisArg, args);
  }

  withStoreScope(): Disposable {
    return {
      [SymbolDispose]() {},
    };
  }
}

function channel(name: ChannelName): AnyChannel {
  const channel = findChannel(name);
  if (channel) return channel;

  if (typeof name !== "string" && typeof name !== "symbol") {
    throw $ERR_INVALID_ARG_TYPE("channel", ["string", "symbol"], name);
  }

  return new Channel(name);
}

function subscribe(name: ChannelName, subscription: Subscription) {
  return channel(name).subscribe(subscription);
}

function unsubscribe(name: ChannelName, subscription: Subscription) {
  return channel(name).unsubscribe(subscription);
}

function hasSubscribers(name: ChannelName) {
  const channel = findChannel(name);
  if (!channel) return false;

  return channel.hasSubscribers;
}

type BoundedEvent = "start" | "end";
type TraceEvent = BoundedEvent | "asyncStart" | "asyncEnd" | "error";
type Handlers<Event extends TraceEvent> = Partial<Record<Event, Subscription>>;
type NameOrChannels<Event extends TraceEvent> = string | Record<Event, AnyChannel>;

function channelFromMap<Event extends TraceEvent>(
  nameOrChannels: NameOrChannels<Event>,
  name: Event,
  className: string,
): AnyChannel {
  if (typeof nameOrChannels === "string") {
    return channel(`tracing:${nameOrChannels}:${name}`);
  }

  if (typeof nameOrChannels === "object" && nameOrChannels !== null) {
    const channel: unknown = nameOrChannels[name];
    if (!(channel instanceof Channel)) {
      throw $ERR_INVALID_ARG_TYPE(`nameOrChannels.${name}`, ["Channel"], channel);
    }
    return channel;
  }

  throw $ERR_INVALID_ARG_TYPE("nameOrChannels", ["string", "object", className], nameOrChannels);
}

/** Undefined if neither has subscribers: one that comes before `closeWindow` would see an end without a start. */
function openWindow(start: AnyChannel, end: AnyChannel, context: unknown) {
  return start.hasSubscribers || end.hasSubscribers ? enterStores(start, context) : undefined;
}

/** Throws `error` if `failed`, together with whatever else is thrown on the way. */
function closeWindow(
  end: AnyChannel,
  context: unknown,
  scopes: Disposable[] | undefined,
  failed: boolean,
  error?: unknown,
) {
  if (scopes === undefined) {
    scopes = kNoScopes;
  } else {
    try {
      end.publish(context);
    } catch (thrown) {
      error = failed ? aggregate(thrown, error) : thrown;
      failed = true;
    }
  }
  exitStores(scopes, failed, error);
}

class BoundedChannelScope {
  #context: unknown;
  #end: AnyChannel | undefined;
  #scopes: Disposable[] | undefined;

  constructor(boundedChannel: BoundedChannel, context: unknown) {
    if (!boundedChannel.hasSubscribers) {
      return;
    }

    // Node hands every scope the same frozen object, which a subscriber can neither write to nor tell from another scope's.
    if (context === undefined) context = { __proto__: null };

    const { start, end } = boundedChannel;
    this.#context = context;
    this.#end = end;
    this.#scopes = enterStores(start, context);
  }

  [SymbolDispose]() {
    const scopes = this.#scopes;
    this.#scopes = undefined;
    closeWindow(this.#end!, this.#context, scopes, false);
  }
}

class BoundedChannel {
  declare readonly start: AnyChannel;
  declare readonly end: AnyChannel;

  constructor(nameOrChannels: NameOrChannels<BoundedEvent>) {
    ObjectDefineProperty(this, "start", {
      __proto__: null,
      value: channelFromMap(nameOrChannels, "start", "BoundedChannel"),
    });
    ObjectDefineProperty(this, "end", {
      __proto__: null,
      value: channelFromMap(nameOrChannels, "end", "BoundedChannel"),
    });
  }

  get hasSubscribers() {
    return this.start?.hasSubscribers || this.end?.hasSubscribers;
  }

  subscribe(handlers: Handlers<BoundedEvent>) {
    const { start, end } = handlers;
    if (start) this.start?.subscribe(start);
    if (end) this.end?.subscribe(end);
  }

  unsubscribe(handlers: Handlers<BoundedEvent>) {
    const { start, end } = handlers;
    let done = true;
    if (start && !this.start?.unsubscribe(start)) done = false;
    if (end && !this.end?.unsubscribe(end)) done = false;
    return done;
  }

  withScope(context: unknown = undefined): Disposable {
    return new BoundedChannelScope(this, context);
  }

  run(context: unknown, fn: Traced, thisArg?: unknown, ...args: unknown[]) {
    context ??= {};
    const scope = this.withScope(context);
    let result;
    try {
      result = fn.$apply(thisArg, args);
    } catch (error) {
      exitStores([scope], true, error);
    }
    scope[SymbolDispose]();
    return result;
  }
}

function boundedChannel(nameOrChannels: NameOrChannels<BoundedEvent>) {
  return new BoundedChannel(nameOrChannels);
}

interface TraceContext {
  __proto__?: null;
  result?: unknown;
  error?: unknown;
}

// A context that refuses the write, as a frozen one does, must not change the outcome of the traced call.
function setResult(context: TraceContext, result: unknown) {
  try {
    context.result = result;
  } catch {}
}

function publishError(errorChannel: AnyChannel, context: TraceContext, error: unknown) {
  try {
    context.error = error;
  } catch {}
  errorChannel.publish(context);
}

/** Throws `error`. */
function closeWindowWithError(
  end: AnyChannel,
  errorChannel: AnyChannel,
  context: TraceContext,
  scopes: Disposable[] | undefined,
  error: unknown,
) {
  try {
    publishError(errorChannel, context, error);
  } catch (thrown) {
    error = aggregate(thrown, error);
  }
  closeWindow(end, context, scopes, true, error);
}

// Node hands out a promise chained to a native one, which lacks the original's own properties and rejects unhandled where the
// original was handled, and calls then() of any other promise, which hides its unhandled rejection.
function traceSettlement(
  thenable: unknown,
  then: Traced,
  asyncStart: AnyChannel,
  asyncEnd: AnyChannel,
  errorChannel: AnyChannel,
  context: TraceContext,
) {
  let settled = false;

  function settle(failed: boolean, value: unknown) {
    if (settled) return;
    settled = true;
    try {
      if (failed) publishError(errorChannel, context, value);
      else setResult(context, value);
      closeWindow(asyncEnd, context, openWindow(asyncStart, asyncEnd, context), false);
    } catch (error) {
      reportOnNextTick(error);
    }
  }

  function onResolve(result: unknown) {
    settle(false, result);
    return result;
  }

  function onReject(error: unknown) {
    settle(true, error);
  }

  if (observePromise(thenable, then, onResolve, onReject)) return;

  try {
    then.$call(thenable, onResolve, onReject);
  } catch (error) {
    onReject(error);
  }
}

function wrapCallback(
  callback: Traced,
  asyncStart: AnyChannel,
  asyncEnd: AnyChannel,
  errorChannel: AnyChannel,
  context: TraceContext,
) {
  return function wrappedCallback(this: unknown, err: unknown, res: unknown) {
    if (err) {
      publishError(errorChannel, context, err);
    } else {
      setResult(context, res);
    }

    const scopes = openWindow(asyncStart, asyncEnd, context);
    let result;
    try {
      result = callback.$apply(this, arguments);
    } catch (thrown) {
      closeWindow(asyncEnd, context, scopes, true, thrown);
    }
    closeWindow(asyncEnd, context, scopes, false);
    return result;
  };
}

function emitNonThenableWarning(fn: Traced) {
  process.emitWarning(
    `tracePromise was called with the function '${fn.name || "<anonymous>"}', which returned a non-thenable.`,
  );
}

class TracingChannel {
  #start: AnyChannel;
  #end: AnyChannel;
  #asyncStart: AnyChannel;
  #asyncEnd: AnyChannel;
  declare readonly error: AnyChannel;

  constructor(nameOrChannels: NameOrChannels<TraceEvent>) {
    this.#start = channelFromMap(nameOrChannels, "start", "TracingChannel");
    this.#end = channelFromMap(nameOrChannels, "end", "TracingChannel");
    this.#asyncStart = channelFromMap(nameOrChannels, "asyncStart", "TracingChannel");
    this.#asyncEnd = channelFromMap(nameOrChannels, "asyncEnd", "TracingChannel");
    ObjectDefineProperty(this, "error", {
      __proto__: null,
      value: channelFromMap(nameOrChannels, "error", "TracingChannel"),
    });
  }

  get start() {
    return this.#start;
  }

  get end() {
    return this.#end;
  }

  get asyncStart() {
    return this.#asyncStart;
  }

  get asyncEnd() {
    return this.#asyncEnd;
  }

  get hasSubscribers() {
    return (
      this.#start.hasSubscribers ||
      this.#end.hasSubscribers ||
      this.#asyncStart.hasSubscribers ||
      this.#asyncEnd.hasSubscribers ||
      this.error?.hasSubscribers
    );
  }

  subscribe(handlers: Handlers<TraceEvent>) {
    const { start, end, asyncStart, asyncEnd, error } = handlers;
    if (start) this.#start.subscribe(start);
    if (end) this.#end.subscribe(end);
    if (asyncStart) this.#asyncStart.subscribe(asyncStart);
    if (asyncEnd) this.#asyncEnd.subscribe(asyncEnd);
    if (error) this.error.subscribe(error);
  }

  unsubscribe(handlers: Handlers<TraceEvent>) {
    const { start, end, asyncStart, asyncEnd, error } = handlers;
    let done = true;
    if (start && !this.#start.unsubscribe(start)) done = false;
    if (end && !this.#end.unsubscribe(end)) done = false;
    if (asyncStart && !this.#asyncStart.unsubscribe(asyncStart)) done = false;
    if (asyncEnd && !this.#asyncEnd.unsubscribe(asyncEnd)) done = false;
    if (error && !this.error.unsubscribe(error)) done = false;
    return done;
  }

  traceSync(fn: Traced, context: TraceContext | undefined = undefined, thisArg?: unknown, ...args: unknown[]) {
    if (!this.hasSubscribers) {
      return fn.$apply(thisArg, args);
    }

    context ??= { __proto__: null };

    const { error } = this;
    const end = this.#end;
    const scopes = openWindow(this.#start, end, context);

    let result;
    try {
      result = fn.$apply(thisArg, args);
    } catch (thrown) {
      closeWindowWithError(end, error, context, scopes, thrown);
    }
    setResult(context, result);
    closeWindow(end, context, scopes, false);
    return result;
  }

  tracePromise(fn: Traced, context: TraceContext | undefined = undefined, thisArg?: unknown, ...args: unknown[]) {
    if (!this.hasSubscribers) {
      const result = fn.$apply(thisArg, args);
      if (typeof (result as PromiseLike<unknown> | undefined)?.then !== "function") {
        emitNonThenableWarning(fn);
      }
      return result;
    }

    context ??= { __proto__: null };

    const { error } = this;
    const end = this.#end;
    const scopes = openWindow(this.#start, end, context);

    let result;
    try {
      result = fn.$apply(thisArg, args);
      const then = (result as PromiseLike<unknown> | undefined)?.then;
      if (typeof then === "function") {
        traceSettlement(result, then, this.#asyncStart, this.#asyncEnd, error, context);
      } else {
        emitNonThenableWarning(fn);
        setResult(context, result);
      }
    } catch (thrown) {
      closeWindowWithError(end, error, context, scopes, thrown);
    }
    closeWindow(end, context, scopes, false);
    return result;
  }

  traceCallback(
    fn: Traced,
    position = -1,
    context: TraceContext | undefined = undefined,
    thisArg?: unknown,
    ...args: unknown[]
  ) {
    if (!this.hasSubscribers) {
      return fn.$apply(thisArg, args);
    }

    context ??= { __proto__: null };

    const { error } = this;
    const end = this.#end;

    const callback: Traced = ArrayPrototypeAt.$call(args, position);
    validateFunction(callback, "callback");
    const wrapped = wrapCallback(callback, this.#asyncStart, this.#asyncEnd, error, context);
    ArrayPrototypeSplice.$call(args, position, 1, wrapped);

    const scopes = openWindow(this.#start, end, context);

    let result;
    try {
      result = fn.$apply(thisArg, args);
    } catch (thrown) {
      closeWindowWithError(end, error, context, scopes, thrown);
    }
    closeWindow(end, context, scopes, false);
    return result;
  }
}

function tracingChannel(nameOrChannels: NameOrChannels<TraceEvent>) {
  return new TracingChannel(nameOrChannels);
}

function linkBuiltinChannel(name: ChannelName) {
  const builtin = builtinChannels.byName.$get(name);
  if (builtin !== undefined) {
    const active = findActiveChannel(name);
    builtin.channel = active;
    builtin.hasSubscribers = active !== undefined;
  }
}
builtinChannels.link = linkBuiltinChannel;

function linkHook(name: string, createHook: (channel: ActiveChannel) => Function) {
  const active = findActiveChannel(name);
  setHook(name, active && createHook(active));
}

/** Tells whoever in Bun publishes under `name` which channel to publish to, if any. */
function link(name: ChannelName) {
  linkBuiltinChannel(name);

  switch (name) {
    case "console.log":
    case "console.info":
    case "console.debug":
    case "console.warn":
    case "console.error":
      if (!IS_COMPILED_AHEAD_OF_TIME) linkHook(name, createConsoleHook);
      break;
    case "tracing:module.require:start":
    case "tracing:module.require:end":
    case "tracing:module.require:asyncStart":
    case "tracing:module.require:asyncEnd":
    case "tracing:module.require:error":
      if (!IS_COMPILED_AHEAD_OF_TIME) linkModuleRequire();
      break;
    case "tracing:module.import:start":
    case "tracing:module.import:end":
    case "tracing:module.import:asyncStart":
    case "tracing:module.import:asyncEnd":
    case "tracing:module.import:error":
      if (!IS_COMPILED_AHEAD_OF_TIME) linkModuleImport();
      break;
    case "process.execve":
      linkHook(name, createExecveHook);
      break;
    case "sqlite.db.query":
      linkHook(name, createSqliteHook);
      break;
    case "undici:client:beforeConnect":
    case "undici:client:connected":
    case "undici:client:connectError":
    case "undici:client:sendHeaders":
    case "undici:request:create":
    case "undici:request:bodySent":
    case "undici:request:bodyChunkSent":
    case "undici:request:bodyChunkReceived":
    case "undici:request:headers":
    case "undici:request:trailers":
    case "undici:request:error":
      setHook("undici:request", require("internal/undici_channels").requestHook());
      break;
    case "undici:websocket:open":
    case "undici:websocket:close":
    case "undici:websocket:socket_error":
    case "undici:websocket:ping":
    case "undici:websocket:pong":
      setHook("undici:websocket", require("internal/undici_channels").webSocketHook());
      break;
  }
}

function createConsoleHook(channel: ActiveChannel) {
  // `method` is one that, in Node, makes the arguments for the method that publishes. Returns what to print, unless it is up to `method`.
  return (args: unknown[], method?: "assert" | "count" | "table" | "time" | "trace", callee?: Function) => {
    switch (method) {
      case undefined:
        channel.publish(args);
        return args;
      case "assert":
        if (typeof args[0] === "string") args[0] = `Assertion failed: ${args[0]}`;
        else ArrayPrototypeUnshift.$call(args, "Assertion failed");
        break;
      case "count":
        args = [`${args[0]}: ${args[1]}`];
        break;
      case "time":
        args[1] = require("internal/util/debuglog").formatTime(args[1] as number);
        ArrayPrototypeUnshift.$call(args, "%s: %s");
        break;
      case "trace": {
        const trace = new SafeError(require("internal/util/inspect").format.$apply(undefined, args));
        trace.name = "Trace";
        ErrorCaptureStackTrace(trace, callee);
        args = [trace.stack];
        break;
      }
    }
    const made = ArrayPrototypeSlice.$call(args);
    channel.publish(args);
    if (args.length !== made.length) return args;
    for (let i = 0; i < made.length; i++) {
      if (!ObjectIs(args[i], made[i])) return args;
    }
  };
}

function createExecveHook(channel: ActiveChannel) {
  return (execPath: string, args: string[], env: string[]) => channel.publish({ execPath, args, env });
}

function createSqliteHook(channel: ActiveChannel) {
  return (sql: string, database: object, duration: number) =>
    channel.publish({ __proto__: null, sql, database, duration });
}

let onRequire: TracingChannel | undefined;
let originalRequire: Traced | undefined;

function traceRequire(parent: JSCommonJSModule, id: string, options: unknown) {
  if (typeof id !== "string" || id === "") return originalRequire!.$call(parent, id, options, traceRequire);
  const context = { __proto__: null, parentFilename: parent?.filename, id };
  return onRequire!.traceSync(originalRequire!, context, parent, id, options, traceRequire);
}

function evaluateModule(module: JSCommonJSModule) {
  $evaluateCommonJSModule(module, undefined);
  return module.exports;
}

/** For a CommonJS module that is imported, or is the entry point. */
function traceEvaluation(module: JSCommonJSModule, id: string) {
  const context = { __proto__: null, parentFilename: undefined, id };
  onRequire!.traceSync(evaluateModule, context, undefined, module);
}

function linkModuleRequire() {
  originalRequire ??= $cpp("NodeDiagnosticsChannel.cpp", "createOriginalRequireFunction") as Traced;
  const { hasSubscribers } = (onRequire ??= new TracingChannel("module.require"));
  $putByIdDirectPrivate($requireMap, "traceRequire", hasSubscribers ? traceRequire : undefined);
  setHook("module.require", hasSubscribers ? traceEvaluation : undefined);
}

let onImport: TracingChannel | undefined;

function startImport(parentURL: string | undefined, url: string) {
  const { start, end, asyncStart, asyncEnd, error } = onImport!;
  const context = { __proto__: null, parentURL, url };
  const scopes = openWindow(start, end, context);
  return function endImport(promise: Promise<unknown>) {
    traceSettlement(promise, promise.$then, asyncStart, asyncEnd, error, context);
    closeWindow(end, context, scopes, false);
  };
}

function linkModuleImport() {
  const { hasSubscribers } = (onImport ??= new TracingChannel("module.import"));
  setHook("module.import", hasSubscribers ? startImport : undefined);
}

export default {
  channel,
  hasSubscribers,
  subscribe,
  tracingChannel,
  unsubscribe,
  boundedChannel,
  Channel,
  BoundedChannel,
};
