// Hardcoded module "node:diagnostics_channel"
// Reference: https://github.com/nodejs/node/blob/v26.3.0/lib/diagnostics_channel.js

const { validateFunction } = require("internal/validators");

const SafeMap = Map;
const SafeFinalizationRegistry = FinalizationRegistry;
const SafeDisposableStack = DisposableStack;

const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeSplice = Array.prototype.splice;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const SymbolDispose = Symbol.dispose;
const SymbolHasInstance = Symbol.hasInstance;
const PromiseResolve = Promise.$resolve.bind(Promise);
const PromiseReject = Promise.$reject.bind(Promise);
const PromisePrototypeThen = (promise, onFulfilled, onRejected) => promise.then(onFulfilled, onRejected);

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

  set(key, value) {
    this.#finalizers.register(value, key);
    return super.set(key, new WeakReference(value));
  }

  get(key) {
    return super.get(key)?.get();
  }

  incRef(key) {
    return super.get(key)?.incRef();
  }

  decRef(key) {
    return super.get(key)?.decRef();
  }
}

function markActive(channel) {
  ObjectSetPrototypeOf.$call(null, channel, ActiveChannel.prototype);
  channel._subscribers = [];
  channel._stores = new SafeMap();
}

function maybeMarkInactive(channel) {
  // When there are no more active subscribers or bound, restore to fast prototype.
  if (!channel._subscribers.length && !channel._stores.size) {
    ObjectSetPrototypeOf.$call(null, channel, Channel.prototype);
    channel._subscribers = undefined;
    channel._stores = undefined;
  }
}

function defaultTransform(data) {
  return data;
}

function wrapStoreRun(store, data, next, transform = defaultTransform) {
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

class RunStoresScope {
  #stack;

  constructor(activeChannel, data) {
    const stack = new SafeDisposableStack();
    let taken = false;

    try {
      const stores = activeChannel._stores;
      if (stores) {
        for (const entry of stores.entries()) {
          const store = entry[0];
          const transform = entry[1];

          let newContext = data;
          if (transform) {
            try {
              newContext = transform(data);
            } catch (err) {
              process.nextTick(() => reportError(err));
              continue;
            }
          }

          stack.use(store.withScope(newContext));
        }
      }

      activeChannel.publish(data);

      this.#stack = stack.move();
      taken = true;
    } finally {
      if (!taken) stack[SymbolDispose]();
    }
  }

  [SymbolDispose]() {
    this.#stack[SymbolDispose]();
  }
}

class ActiveChannel {
  _subscribers;
  name;
  _stores;

  subscribe(subscription) {
    validateFunction(subscription, "subscription");

    $arrayPush(this._subscribers, subscription);
    channels.incRef(this.name);
  }

  unsubscribe(subscription) {
    const index = ArrayPrototypeIndexOf.$call(this._subscribers, subscription);
    if (index === -1) return false;

    ArrayPrototypeSplice.$call(this._subscribers, index, 1);

    channels.decRef(this.name);
    maybeMarkInactive(this);

    return true;
  }

  bindStore(store, transform) {
    const replacing = this._stores.has(store);
    if (!replacing) channels.incRef(this.name);
    this._stores.set(store, transform);
  }

  unbindStore(store) {
    if (!this._stores.has(store)) {
      return false;
    }

    this._stores.delete(store);

    channels.decRef(this.name);
    maybeMarkInactive(this);

    return true;
  }

  get hasSubscribers() {
    return true;
  }

  publish(data) {
    for (let i = 0; i < (this._subscribers?.length || 0); i++) {
      try {
        const onMessage = this._subscribers[i];
        onMessage(data, this.name);
      } catch (err) {
        process.nextTick(() => reportError(err));
      }
    }
  }

  withStoreScope(data) {
    return new RunStoresScope(this, data);
  }

  runStores(data, fn, thisArg, ...args) {
    let run = () => {
      this.publish(data);
      return fn.$apply(thisArg, args);
    };

    for (const entry of this._stores.entries()) {
      const store = entry[0];
      const transform = entry[1];
      run = wrapStoreRun(store, data, run, transform);
    }

    return run();
  }
}

class Channel {
  _subscribers;
  _stores;
  name;

  constructor(name) {
    this._subscribers = undefined;
    this._stores = undefined;
    this.name = name;

    channels.set(name, this);
  }

  static [SymbolHasInstance](instance) {
    const prototype = ObjectGetPrototypeOf.$call(null, instance);
    return prototype === Channel.prototype || prototype === ActiveChannel.prototype;
  }

  subscribe(subscription) {
    markActive(this);
    this.subscribe(subscription);
  }

  unsubscribe() {
    return false;
  }

  bindStore(store, transform) {
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

  runStores(data, fn, thisArg, ...args) {
    return fn.$apply(thisArg, args);
  }

  withStoreScope() {
    return { [SymbolDispose]() {} };
  }
}

const channels = new WeakRefMap();

function channel(name) {
  const channel = channels.get(name);
  if (channel) return channel;

  if (typeof name !== "string" && typeof name !== "symbol") {
    throw $ERR_INVALID_ARG_TYPE("channel", "string or symbol", name);
  }

  return new Channel(name);
}

function subscribe(name, subscription) {
  return channel(name).subscribe(subscription);
}

function unsubscribe(name, subscription) {
  return channel(name).unsubscribe(subscription);
}

function hasSubscribers(name) {
  const channel = channels.get(name);
  if (!channel) return false;

  return channel.hasSubscribers;
}

const boundedEvents = ["start", "end"];

function assertChannel(value, name) {
  if (!(value instanceof Channel)) {
    throw $ERR_INVALID_ARG_TYPE(name, ["Channel"], value);
  }
}

function channelFromMap(nameOrChannels, name, className) {
  if (typeof nameOrChannels === "string") {
    return channel(`tracing:${nameOrChannels}:${name}`);
  }

  if (typeof nameOrChannels === "object" && nameOrChannels !== null) {
    const channel = nameOrChannels[name];
    assertChannel(channel, `nameOrChannels.${name}`);
    return channel;
  }

  throw $ERR_INVALID_ARG_TYPE("nameOrChannels", ["string", "object", className], nameOrChannels);
}

class BoundedChannelScope {
  #context;
  #end;
  #scope;

  constructor(boundedChannel, context) {
    if (!boundedChannel.hasSubscribers) {
      return;
    }

    const { start, end } = boundedChannel;
    this.#context = context;
    this.#end = end;

    this.#scope = new RunStoresScope(start, context);
  }

  [SymbolDispose]() {
    if (!this.#scope) {
      return;
    }

    this.#end.publish(this.#context);

    this.#scope[SymbolDispose]();
    this.#scope = undefined;
  }
}

class BoundedChannel {
  constructor(nameOrChannels) {
    for (let i = 0; i < boundedEvents.length; ++i) {
      const eventName = boundedEvents[i];
      ObjectDefineProperty(this, eventName, {
        __proto__: null,
        value: channelFromMap(nameOrChannels, eventName, "BoundedChannel"),
      });
    }
  }

  get hasSubscribers() {
    return this.start?.hasSubscribers || this.end?.hasSubscribers;
  }

  subscribe(handlers) {
    for (let i = 0; i < boundedEvents.length; ++i) {
      const name = boundedEvents[i];
      const handler = handlers[name];
      if (!handler) continue;

      this[name]?.subscribe(handler);
    }
  }

  unsubscribe(handlers) {
    let done = true;

    for (let i = 0; i < boundedEvents.length; ++i) {
      const name = boundedEvents[i];
      const handler = handlers[name];
      if (!handler) continue;

      if (!this[name]?.unsubscribe(handler)) {
        done = false;
      }
    }

    return done;
  }

  withScope(context = {}) {
    return new BoundedChannelScope(this, context);
  }

  run(context, fn, thisArg, ...args) {
    context ??= {};
    const scope = this.withScope(context);
    try {
      return fn.$apply(thisArg, args);
    } finally {
      scope[SymbolDispose]();
    }
  }
}

function boundedChannel(nameOrChannels) {
  return new BoundedChannel(nameOrChannels);
}

class TracingChannel {
  #callWindow;
  #continuationWindow;

  constructor(nameOrChannels) {
    if (typeof nameOrChannels === "string") {
      this.#callWindow = new BoundedChannel(nameOrChannels);
      this.#continuationWindow = new BoundedChannel({
        start: channel(`tracing:${nameOrChannels}:asyncStart`),
        end: channel(`tracing:${nameOrChannels}:asyncEnd`),
      });
    } else if (typeof nameOrChannels === "object" && nameOrChannels !== null) {
      const { start, end, asyncStart, asyncEnd } = nameOrChannels;
      assertChannel(start, "nameOrChannels.start");
      assertChannel(end, "nameOrChannels.end");
      assertChannel(asyncStart, "nameOrChannels.asyncStart");
      assertChannel(asyncEnd, "nameOrChannels.asyncEnd");

      this.#callWindow = new BoundedChannel({ start, end });
      this.#continuationWindow = new BoundedChannel({ start: asyncStart, end: asyncEnd });
    }

    ObjectDefineProperty(this, "error", {
      __proto__: null,
      value: channelFromMap(nameOrChannels, "error", "TracingChannel"),
    });
  }

  get start() {
    return this.#callWindow.start;
  }

  get end() {
    return this.#callWindow.end;
  }

  get asyncStart() {
    return this.#continuationWindow.start;
  }

  get asyncEnd() {
    return this.#continuationWindow.end;
  }

  get hasSubscribers() {
    return this.#callWindow.hasSubscribers || this.#continuationWindow.hasSubscribers || this.error?.hasSubscribers;
  }

  subscribe(handlers) {
    const { start, end, asyncStart, asyncEnd, error } = handlers;

    if (start || end) {
      this.#callWindow.subscribe({ start, end });
    }

    if (asyncStart || asyncEnd) {
      this.#continuationWindow.subscribe({ start: asyncStart, end: asyncEnd });
    }

    if (error) {
      this.error.subscribe(error);
    }
  }

  unsubscribe(handlers) {
    const { start, end, asyncStart, asyncEnd, error } = handlers;
    let done = true;

    if (start || end) {
      if (!this.#callWindow.unsubscribe({ start, end })) {
        done = false;
      }
    }

    if (asyncStart || asyncEnd) {
      if (!this.#continuationWindow.unsubscribe({ start: asyncStart, end: asyncEnd })) {
        done = false;
      }
    }

    if (error) {
      if (!this.error.unsubscribe(error)) {
        done = false;
      }
    }

    return done;
  }

  traceSync(fn, context = {}, thisArg, ...args) {
    const { start, end, error } = this;

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
        end.publish(context);
      }
    });
  }

  tracePromise(fn, context = {}, thisArg, ...args) {
    const { start, end, asyncStart, asyncEnd, error } = this;

    function reject(err) {
      context.error = err;
      error.publish(context);
      asyncStart.publish(context);
      // TODO: Is there a way to have asyncEnd _after_ the continuation?
      asyncEnd.publish(context);
      return PromiseReject(err);
    }

    function resolve(result) {
      context.result = result;
      asyncStart.publish(context);
      // TODO: Is there a way to have asyncEnd _after_ the continuation?
      asyncEnd.publish(context);
      return result;
    }

    return start.runStores(context, () => {
      try {
        let promise = fn.$apply(thisArg, args);
        // Convert thenables to native promises
        if (!(promise instanceof Promise)) {
          promise = PromiseResolve(promise);
        }
        return PromisePrototypeThen(promise, resolve, reject);
      } catch (err) {
        context.error = err;
        error.publish(context);
        throw err;
      } finally {
        end.publish(context);
      }
    });
  }

  traceCallback(fn, position = -1, context = {}, thisArg, ...args) {
    const { start, end, asyncStart, asyncEnd, error } = this;

    function wrappedCallback(err, res) {
      if (err) {
        context.error = err;
        error.publish(context);
      } else {
        context.result = res;
      }

      // Using runStores here enables manual context failure recovery
      asyncStart.runStores(context, () => {
        try {
          if (callback) {
            return callback.$apply(this, arguments);
          }
        } finally {
          asyncEnd.publish(context);
        }
      });
    }

    const callback = ArrayPrototypeAt.$call(args, position);
    validateFunction(callback, "callback");
    ArrayPrototypeSplice.$call(args, position, 1, wrappedCallback);

    return start.runStores(context, () => {
      try {
        return fn.$apply(thisArg, args);
      } catch (err) {
        context.error = err;
        error.publish(context);
        throw err;
      } finally {
        end.publish(context);
      }
    });
  }
}

function tracingChannel(nameOrChannels) {
  return new TracingChannel(nameOrChannels);
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
