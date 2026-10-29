// Hardcoded module "node:diagnostics_channel"
// Reference: https://github.com/nodejs/node/blob/fb47afc335ef78a8cef7eac52b8ee7f045300696/lib/diagnostics_channel.js
// subscribe(), the order of runStores() and TracingChannel's trace methods follow v26.12.1 of that file, without its BoundedChannel.

const { validateFunction } = require("internal/validators");

const SafeMap = Map;
const SafeFinalizationRegistry = FinalizationRegistry;

const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ObjectCreate = Object.create;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const PromisePrototype = $Promise.prototype;
const PromisePrototypeThen = $Promise.prototype.$then;
const SymbolHasInstance = Symbol.hasInstance;

type ChannelName = string | symbol;
type Subscription = (message: unknown, name: ChannelName) => void;
type Transform = (data: unknown) => unknown;
type Store = InstanceType<$BunModules["node:async_hooks"]["AsyncLocalStorage"]>;
type Traced = (...args: any[]) => unknown;
/** One object: `markActive` and `maybeMarkInactive` move it from one prototype to the other. */
type AnyChannel = Channel | ActiveChannel;

// TODO: https://github.com/nodejs/node/blob/fb47afc335ef78a8cef7eac52b8ee7f045300696/src/node_util.h#L13
class WeakReference<T extends WeakKey> extends WeakRef<T> {
  #refs = 0;

  get() {
    return this.deref();
  }

  incRef() {
    return ++this.#refs;
  }

  decRef() {
    return --this.#refs;
  }
}

// Can't delete when weakref count reaches 0 as it could increment again.
// Only GC can be used as a valid time to clean up the channels map.
class WeakRefMap extends SafeMap {
  #finalizers = new SafeFinalizationRegistry(key => {
    this.delete(key);
  });

  set(key: ChannelName, value: AnyChannel) {
    this.#finalizers.register(value, key);
    return super.set(key, new WeakReference(value));
  }

  get(key: ChannelName) {
    return (super.get(key) as WeakReference<AnyChannel> | undefined)?.get();
  }

  incRef(key: ChannelName) {
    return (super.get(key) as WeakReference<AnyChannel> | undefined)?.incRef();
  }

  decRef(key: ChannelName) {
    return (super.get(key) as WeakReference<AnyChannel> | undefined)?.decRef();
  }
}

function markActive(channel: AnyChannel) {
  ObjectSetPrototypeOf.$call(null, channel, ActiveChannel.prototype);
  channel._subscribers = [];
  channel._stores = new SafeMap();
}

function maybeMarkInactive(channel: AnyChannel) {
  // When there are no more active subscribers or bound, restore to fast prototype.
  if (!channel._subscribers!.length && !channel._stores!.size) {
    ObjectSetPrototypeOf.$call(null, channel, Channel.prototype);
    channel._subscribers = undefined;
    channel._stores = undefined;
  }
}

function defaultTransform(data: unknown) {
  return data;
}

function wrapStoreRun(store: Store, data: unknown, next: () => unknown, transform: Transform = defaultTransform) {
  return () => {
    let context;
    try {
      context = transform(data);
    } catch (err) {
      process.nextTick(() => reportError(err));
      return next();
    }

    return store.run(context, next);
  };
}

class ActiveChannel {
  _subscribers: Subscription[] | undefined;
  name!: ChannelName;
  _stores: Map<Store, Transform | undefined> | undefined;

  subscribe(subscription: Subscription) {
    validateFunction(subscription, "subscription");

    this._subscribers = ArrayPrototypeSlice.$call(this._subscribers);
    ArrayPrototypePush.$call(this._subscribers, subscription);
    channels.incRef(this.name);
  }

  unsubscribe(subscription: Subscription) {
    const index = ArrayPrototypeIndexOf.$call(this._subscribers, subscription);
    if (index === -1) return false;

    const subscribers = ArrayPrototypeSlice.$call(this._subscribers);
    ArrayPrototypeSplice.$call(subscribers, index, 1);
    this._subscribers = subscribers;

    channels.decRef(this.name);
    maybeMarkInactive(this);

    return true;
  }

  bindStore(store: Store, transform?: Transform) {
    const replacing = this._stores!.has(store);
    if (!replacing) channels.incRef(this.name);
    this._stores!.set(store, transform);
  }

  unbindStore(store: Store) {
    if (!this._stores!.has(store)) {
      return false;
    }

    this._stores!.delete(store);

    channels.decRef(this.name);
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
      } catch (err) {
        process.nextTick(() => reportError(err));
      }
    }
  }

  runStores(data: unknown, fn: Traced, thisArg?: unknown, ...args: unknown[]) {
    let run = (): unknown => {
      this.publish(data);
      return fn.$apply(thisArg, args);
    };

    const stores = this._stores!;
    if (stores.size > 1) {
      // The first store bound is the outermost one, as in Node.js since v26.1.0 (nodejs/node#61680).
      const entries = $Array.from(stores);
      for (let i = entries.length - 1; i >= 0; i--) {
        run = wrapStoreRun(entries[i][0], data, run, entries[i][1]);
      }
    } else {
      for (const entry of stores.entries()) {
        run = wrapStoreRun(entry[0], data, run, entry[1]);
      }
    }

    return run();
  }
}

class Channel {
  _subscribers: Subscription[] | undefined;
  _stores: Map<Store, Transform | undefined> | undefined;
  name: ChannelName;

  constructor(name: ChannelName) {
    this._subscribers = undefined;
    this._stores = undefined;
    this.name = name;

    channels.set(name, this);
  }

  static [SymbolHasInstance](instance: unknown) {
    const prototype = ObjectGetPrototypeOf.$call(null, instance);
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
}

const channels = new WeakRefMap();

function channel(name: ChannelName): AnyChannel {
  const channel = channels.get(name);
  if (channel) return channel;

  if (typeof name !== "string" && typeof name !== "symbol") {
    throw $ERR_INVALID_ARG_TYPE("channel", "string or symbol", name);
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
  const channel = channels.get(name);
  if (!channel) return false;

  return channel.hasSubscribers;
}

const traceEvents = ["start", "end", "asyncStart", "asyncEnd", "error"] as const;
type TraceHandlers = Partial<Record<(typeof traceEvents)[number], Subscription>>;
type TraceChannels = Record<(typeof traceEvents)[number], AnyChannel>;

function assertChannel(value: unknown, name: string) {
  if (!(value instanceof Channel)) {
    throw $ERR_INVALID_ARG_TYPE(name, ["Channel"], value);
  }
}

interface TraceContext {
  result?: unknown;
  error?: unknown;
}

class TracingChannel {
  start: AnyChannel;
  end: AnyChannel;
  asyncStart: AnyChannel;
  asyncEnd: AnyChannel;
  error: AnyChannel;

  constructor(nameOrChannels: string | TraceChannels) {
    if (typeof nameOrChannels === "string") {
      this.start = channel(`tracing:${nameOrChannels}:start`);
      this.end = channel(`tracing:${nameOrChannels}:end`);
      this.asyncStart = channel(`tracing:${nameOrChannels}:asyncStart`);
      this.asyncEnd = channel(`tracing:${nameOrChannels}:asyncEnd`);
      this.error = channel(`tracing:${nameOrChannels}:error`);
    } else if (typeof nameOrChannels === "object") {
      const { start, end, asyncStart, asyncEnd, error } = nameOrChannels;

      assertChannel(start, "nameOrChannels.start");
      assertChannel(end, "nameOrChannels.end");
      assertChannel(asyncStart, "nameOrChannels.asyncStart");
      assertChannel(asyncEnd, "nameOrChannels.asyncEnd");
      assertChannel(error, "nameOrChannels.error");

      this.start = start;
      this.end = end;
      this.asyncStart = asyncStart;
      this.asyncEnd = asyncEnd;
      this.error = error;
    } else {
      throw $ERR_INVALID_ARG_TYPE("nameOrChannels", ["string, object, or Channel"], nameOrChannels);
    }
  }

  subscribe(handlers: TraceHandlers) {
    for (const name of traceEvents) {
      if (!handlers[name]) continue;

      this[name]?.subscribe(handlers[name]);
    }
  }

  unsubscribe(handlers: TraceHandlers) {
    let done = true;

    for (const name of traceEvents) {
      if (!handlers[name]) continue;

      if (!this[name]?.unsubscribe(handlers[name])) {
        done = false;
      }
    }

    return done;
  }

  get hasSubscribers() {
    return (
      this.start.hasSubscribers ||
      this.end.hasSubscribers ||
      this.asyncStart.hasSubscribers ||
      this.asyncEnd.hasSubscribers ||
      this.error.hasSubscribers
    );
  }

  traceSync(fn: Traced, context: TraceContext | undefined = undefined, thisArg?: unknown, ...args: unknown[]) {
    if (!this.hasSubscribers) {
      return fn.$apply(thisArg, args);
    }

    return traceSyncSubscribed(this, fn, context === undefined ? ObjectCreate(null) : context, thisArg, args);
  }

  tracePromise(fn: Traced, context: TraceContext | undefined = undefined, thisArg?: unknown, ...args: unknown[]) {
    if (!this.hasSubscribers) {
      const result: any = fn.$apply(thisArg, args);
      if (typeof result?.then !== "function") {
        emitNonThenableWarning(fn);
      }
      return result;
    }

    return tracePromiseSubscribed(this, fn, context === undefined ? ObjectCreate(null) : context, thisArg, args);
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

    return traceCallbackSubscribed(
      this,
      fn,
      position,
      context === undefined ? ObjectCreate(null) : context,
      thisArg,
      args,
    );
  }
}

// The three functions below are outside the methods so that a trace call with no subscriber creates no closure and no scope.

function traceSyncSubscribed(tc: TracingChannel, fn: Traced, context: TraceContext, thisArg: unknown, args: unknown[]) {
  const { start, end, error } = tc;
  // Node.js's BoundedChannelScope: "end" is published only if start or end had a subscriber when the call began.
  const callWindow = start.hasSubscribers || end.hasSubscribers;

  return start.runStores(context, () => {
    try {
      const result = fn.$apply(thisArg, args);
      context.result = result;
      return result;
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      if (callWindow) end.publish(context);
    }
  });
}

function tracePromiseSubscribed(
  tc: TracingChannel,
  fn: Traced,
  context: TraceContext,
  thisArg: unknown,
  args: unknown[],
) {
  const { start, end, asyncStart, asyncEnd, error } = tc;
  const callWindow = start.hasSubscribers || end.hasSubscribers;

  return start.runStores(context, () => {
    try {
      const result: any = fn.$apply(thisArg, args);
      // A value that is not a thenable goes back as it is, with a warning and no asyncStart or asyncEnd.
      if (typeof result?.then !== "function") {
        emitNonThenableWarning(fn);
        context.result = result;
        return result;
      }

      const onResolve = (value: unknown) => {
        context.result = value;
        publishContinuation(asyncStart, asyncEnd, context);
        return value;
      };
      // An instance of a subclass and a promise of another realm are thenables here: only a direct Promise is chained.
      if ($isPromise(result) && ObjectGetPrototypeOf.$call(null, result) === PromisePrototype) {
        const onRejectWithRethrow = (err: unknown) => {
          publishRejection(error, asyncStart, asyncEnd, context, err);
          throw err;
        };
        return PromisePrototypeThen.$call(result, onResolve, onRejectWithRethrow);
      }
      // The caller keeps its thenable. What then() returns is dropped, so onReject must not throw again.
      const onReject = (err: unknown) => publishRejection(error, asyncStart, asyncEnd, context, err);
      result.then(onResolve, onReject);
      return result;
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      if (callWindow) end.publish(context);
    }
  });
}

// asyncEnd follows asyncStart at once: a promise has no point after its continuation. runStores() is for bound stores.
function publishContinuation(asyncStart: AnyChannel, asyncEnd: AnyChannel, context: TraceContext) {
  if (asyncStart._stores?.size) {
    asyncStart.runStores(context, () => asyncEnd.publish(context));
  } else {
    asyncStart.publish(context);
    asyncEnd.publish(context);
  }
}

function publishRejection(
  error: AnyChannel,
  asyncStart: AnyChannel,
  asyncEnd: AnyChannel,
  context: TraceContext,
  err: unknown,
) {
  context.error = err;
  error.publish(context);
  publishContinuation(asyncStart, asyncEnd, context);
}

function traceCallbackSubscribed(
  tc: TracingChannel,
  fn: Traced,
  position: number,
  context: TraceContext,
  thisArg: unknown,
  args: unknown[],
) {
  const { start, end, asyncStart, asyncEnd, error } = tc;

  function wrappedCallback(this: unknown, err: unknown, res: unknown) {
    if (err) {
      context.error = err;
      error.publish(context);
    } else {
      context.result = res;
    }

    const continuationWindow = asyncStart.hasSubscribers || asyncEnd.hasSubscribers;
    // Using runStores here enables manual context failure recovery
    return asyncStart.runStores(context, () => {
      try {
        return callback.$apply(this, arguments);
      } finally {
        if (continuationWindow) asyncEnd.publish(context);
      }
    });
  }

  const callback: Traced = ArrayPrototypeAt.$call(args, position);
  validateFunction(callback, "callback");
  ArrayPrototypeSplice.$call(args, position, 1, wrappedCallback);

  const callWindow = start.hasSubscribers || end.hasSubscribers;
  return start.runStores(context, () => {
    try {
      return fn.$apply(thisArg, args);
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      if (callWindow) end.publish(context);
    }
  });
}

function emitNonThenableWarning(fn: Traced) {
  process.emitWarning(
    `tracePromise was called with the function '${fn.name || "<anonymous>"}', which returned a non-thenable.`,
  );
}

function tracingChannel(nameOrChannels: string | TraceChannels) {
  return new TracingChannel(nameOrChannels);
}

export default {
  channel,
  hasSubscribers,
  subscribe,
  tracingChannel,
  unsubscribe,
  Channel,
};
