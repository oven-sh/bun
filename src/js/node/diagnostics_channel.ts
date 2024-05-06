// Hardcoded module "node:diagnostics_channel"
// Reference: https://github.com/nodejs/node/blob/fb47afc335ef78a8cef7eac52b8ee7f045300696/lib/diagnostics_channel.js
const SafeMap = Map;
const SafeFinalizationRegistry = FinalizationRegistry;

const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeSplice = Array.prototype.splice;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const SymbolHasInstance = Symbol.hasInstance;
const PromiseResolve = Promise.resolve;
const PromiseReject = Promise.reject;
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

class ActiveChannel {
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
}

const channels = new WeakRefMap();

function channel(name) {
  const channel = channels.get(name);
  if (channel) return channel;

  if (typeof name !== "string" && typeof name !== "symbol") {
    throw new ERR_INVALID_ARG_TYPE("channel", ["string", "symbol"], name);
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

const traceEvents = ["start", "end", "asyncStart", "asyncEnd", "error"];

function assertChannel(value, name) {
  if (!(value instanceof Channel)) {
    throw new ERR_INVALID_ARG_TYPE(name, ["Channel"], value);
  }
}

class TracingChannel {
  constructor(nameOrChannels) {
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
      throw new ERR_INVALID_ARG_TYPE("nameOrChannels", ["string", "object", "Channel"], nameOrChannels);
    }
  }

  subscribe(handlers) {
    for (const name of traceEvents) {
      if (!handlers[name]) continue;

      this[name]?.subscribe(handlers[name]);
    }
  }

  unsubscribe(handlers) {
    let done = true;

    for (const name of traceEvents) {
      if (!handlers[name]) continue;

      if (!this[name]?.unsubscribe(handlers[name])) {
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
    if (typeof callback !== "function") {
      throw new ERR_INVALID_ARG_TYPE("callback", ["function"], callback);
    }
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

class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor(name, expected, actual) {
    super(`The ${name} argument must be of type ${expected}. Received type ${typeof actual}`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}

function validateFunction(callable, field) {
  if (typeof callable !== "function") {
    throw new ERR_INVALID_ARG_TYPE(field, "Function", callable);
  }

  return callable;
}

export default {
  channel,
  hasSubscribers,
  subscribe,
  tracingChannel,
  unsubscribe,
  Channel,
};
