// Hardcoded module "node:diagnostics_channel"
// Reference: https://github.com/nodejs/node/blob/fb47afc335ef78a8cef7eac52b8ee7f045300696/lib/diagnostics_channel.js

const { validateFunction } = require("internal/validators");

const SafeMap = Map;
const SafeFinalizationRegistry = FinalizationRegistry;

const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypeSplice = Array.prototype.splice;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const SymbolHasInstance = Symbol.hasInstance;
const PromiseResolve = Promise.resolve.bind(Promise);
const PromiseReject = Promise.reject.bind(Promise);
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
class WeakRefMap extends SafeMap<any, WeakReference<any>> {
  #finalizers = new SafeFinalizationRegistry(key => {
    // Note: `this` refers to the WeakRefMap instance here.
    // The base Map's delete method should be called.
    super.delete(key);
  });

  // @ts-ignore // TS2411: Custom method conflicts with Map index signature
  set(key: any, value: any): this {
    this.#finalizers.register(value, key);
    // Ensure the value stored is a WeakReference
    return super.set(key, new WeakReference(value));
  }

  // @ts-ignore // TS2411: Custom method conflicts with Map index signature
  get(key: any): any | undefined {
    // Retrieve the WeakReference and dereference it
    const ref = super.get(key);
    return ref?.get(); // ref?.deref() is the same as ref?.get() based on WeakReference impl
  }

  // @ts-ignore // TS2411: Custom method conflicts with Map index signature
  incRef(key: any): number | undefined {
    const ref = super.get(key);
    return ref?.incRef();
  }

  // @ts-ignore // TS2411: Custom method conflicts with Map index signature
  decRef(key: any): number | undefined {
    const ref = super.get(key);
    return ref?.decRef();
  }
}

function markActive(channel: Channel) {
  ObjectSetPrototypeOf.call(null, channel, ActiveChannel.prototype);
  (channel as unknown as ActiveChannel)._subscribers = [];
  (channel as unknown as ActiveChannel)._stores = new SafeMap();
}

function maybeMarkInactive(channel: ActiveChannel) {
  // When there are no more active subscribers or bound, restore to fast prototype.
  if (!channel._subscribers.length && !channel._stores.size) {
    ObjectSetPrototypeOf.call(null, channel, Channel.prototype);
    (channel as unknown as Channel)._subscribers = undefined;
    (channel as unknown as Channel)._stores = undefined;
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
  // Properties are initialized by markActive or inherited via prototype switch
  _subscribers!: any[];
  _stores!: Map<any, any>;
  // 'name' is accessed via 'this' which refers to the original Channel instance
  declare name: string | symbol;

  subscribe(subscription) {
    validateFunction(subscription, "subscription");

    $arrayPush(this._subscribers, subscription);
    channels.incRef(this.name);
  }

  unsubscribe(subscription) {
    const index = ArrayPrototypeIndexOf.call(this._subscribers, subscription);
    if (index === -1) return false;

    ArrayPrototypeSplice.call(this._subscribers, index, 1);

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
    // Use optional chaining as _subscribers might be undefined during prototype transition? (unlikely but safe)
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
      return fn.apply(thisArg, args);
    };

    // Use optional chaining for safety during potential prototype transitions
    for (const entry of this._stores?.entries() ?? []) {
      const store = entry[0];
      const transform = entry[1];
      run = wrapStoreRun(store, data, run, transform);
    }

    return run();
  }
}

class Channel {
  _subscribers: undefined | any[];
  _stores: undefined | Map<any, any>;
  name: string | symbol;

  constructor(name: string | symbol) {
    this._subscribers = undefined;
    this._stores = undefined;
    this.name = name;

    channels.set(name, this);
  }

  static [SymbolHasInstance](instance) {
    const prototype = ObjectGetPrototypeOf.call(null, instance);
    return prototype === Channel.prototype || prototype === ActiveChannel.prototype;
  }

  subscribe(subscription) {
    markActive(this);
    (this as unknown as ActiveChannel).subscribe(subscription);
  }

  unsubscribe(subscription?: any) {
    return false;
  }

  bindStore(store, transform) {
    markActive(this);
    (this as unknown as ActiveChannel).bindStore(store, transform);
  }

  unbindStore(store?: any) {
    return false;
  }

  get hasSubscribers() {
    return false;
  }

  publish(data?: any) {}

  runStores(data: any, fn: (...args: any[]) => any, thisArg: any, ...args: any[]) {
    return fn.apply(thisArg, args);
  }
}

const channels = new WeakRefMap();

function channel(name: string | symbol): Channel {
  const existingChannel = channels.get(name);
  if (existingChannel) return existingChannel;

  if (typeof name !== "string" && typeof name !== "symbol") {
    throw $ERR_INVALID_ARG_TYPE("channel", ["string", "symbol"], name);
  }

  return new Channel(name);
}

function subscribe(name: string | symbol, subscription: (message: any, name: string | symbol) => void) {
  return channel(name).subscribe(subscription);
}

function unsubscribe(name: string | symbol, subscription: (message: any, name: string | symbol) => void): boolean {
  // This potentially returns false even if the channel exists but is inactive.
  // This matches Node.js behavior.
  const chan = channels.get(name);
  if (chan) {
    return chan.unsubscribe(subscription);
  }
  return false;
}

function hasSubscribers(name: string | symbol): boolean {
  const chan = channels.get(name);
  if (!chan) return false;

  return chan.hasSubscribers;
}

const traceEvents = ["start", "end", "asyncStart", "asyncEnd", "error"];

function assertChannel(value, name) {
  // Use instanceof check which works due to Symbol.hasInstance override
  if (!(value instanceof Channel)) {
    throw $ERR_INVALID_ARG_TYPE(name, ["Channel"], value);
  }
}

interface TracingContext {
  error?: any;
  result?: any;
}

class TracingChannel {
  start: Channel;
  end: Channel;
  asyncStart: Channel;
  asyncEnd: Channel;
  error: Channel;

  constructor(nameOrChannels: string | Record<string, Channel>) {
    if (typeof nameOrChannels === "string") {
      this.start = channel(`tracing:${nameOrChannels}:start`);
      this.end = channel(`tracing:${nameOrChannels}:end`);
      this.asyncStart = channel(`tracing:${nameOrChannels}:asyncStart`);
      this.asyncEnd = channel(`tracing:${nameOrChannels}:asyncEnd`);
      this.error = channel(`tracing:${nameOrChannels}:error`);
    } else if (typeof nameOrChannels === "object" && nameOrChannels !== null) {
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
      throw $ERR_INVALID_ARG_TYPE("nameOrChannels", ["string", "object"], nameOrChannels);
    }
  }

  subscribe(handlers: Record<string, (context: TracingContext) => void>) {
    for (const name of traceEvents) {
      if (!handlers[name]) continue;
      // Use optional chaining as channels might not exist if constructed with object
      this[name]?.subscribe(handlers[name]);
    }
  }

  unsubscribe(handlers: Record<string, (context: TracingContext) => void>): boolean {
    let done = true;

    for (const name of traceEvents) {
      if (!handlers[name]) continue;

      // Use optional chaining
      if (!this[name]?.unsubscribe(handlers[name])) {
        done = false;
      }
    }

    return done;
  }

  traceSync(fn, context: TracingContext = {}, thisArg?, ...args) {
    const { start, end, error } = this;

    return start.runStores(context, () => {
      try {
        const result = fn.apply(thisArg, args);
        context.result = result;
        return result;
      } catch (err) {
        context.error = err;
        error.publish(context);
        throw err;
      } finally {
        end.publish(context);
      }
    }, undefined, ...args); // Pass args explicitly
  }

  tracePromise(fn, context: TracingContext = {}, thisArg?, ...args) {
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
        let promise = fn.apply(thisArg, args);
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
    }, undefined, ...args); // Pass args explicitly
  }

  traceCallback(fn, position = -1, context: TracingContext = {}, thisArg?, ...args) {
    const { start, end, asyncStart, asyncEnd, error } = this;
    const originalCallback = ArrayPrototypeAt.call(args, position);
    validateFunction(originalCallback, "callback");

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
          // Use standard call, pass original arguments explicitly
          return originalCallback.call(null, err, res); // Assuming standard (err, res) signature
        } finally {
          asyncEnd.publish(context);
        }
      }, undefined, err, res); // Pass args explicitly
    }

    ArrayPrototypeSplice.call(args, position, 1, wrappedCallback);

    return start.runStores(context, () => {
      try {
        return fn.apply(thisArg, args);
      } catch (err) {
        context.error = err;
        error.publish(context);
        throw err;
      } finally {
        end.publish(context);
      }
    }, undefined, ...args); // Pass args explicitly
  }
}

function tracingChannel(nameOrChannels: string | Record<string, Channel>): TracingChannel {
  return new TracingChannel(nameOrChannels);
}

// Added reportError function stub if it's not globally available
declare var reportError: (err: any) => void;
if (typeof reportError === "undefined") {
  globalThis.reportError = err => {
    console.error("Unhandled error in diagnostics_channel:", err);
  };
}

export default {
  channel,
  hasSubscribers,
  subscribe,
  tracingChannel,
  unsubscribe,
  Channel,
};