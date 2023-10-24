(function (){"use strict";// build3/tmp/node/diagnostics_channel.ts
var markActive = function(channel) {
  ObjectSetPrototypeOf(channel, ActiveChannel.prototype);
  channel._subscribers = [];
  channel._stores = new SafeMap;
};
var maybeMarkInactive = function(channel) {
  if (!channel._subscribers.length && !channel._stores.size) {
    ObjectSetPrototypeOf(channel, Channel.prototype);
    channel._subscribers = @undefined;
    channel._stores = @undefined;
  }
};
var defaultTransform = function(data) {
  return data;
};
var wrapStoreRun = function(store, data, next, transform = defaultTransform) {
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
};
var channel = function(name) {
  const channel2 = channels.get(name);
  if (channel2)
    return channel2;
  if (typeof name !== "string" && typeof name !== "symbol") {
    throw new ERR_INVALID_ARG_TYPE("channel", ["string", "symbol"], name);
  }
  return new Channel(name);
};
var subscribe = function(name, subscription) {
  return channel(name).subscribe(subscription);
};
var unsubscribe = function(name, subscription) {
  return channel(name).unsubscribe(subscription);
};
var hasSubscribers = function(name) {
  const channel2 = channels.get(name);
  if (!channel2)
    return false;
  return channel2.hasSubscribers;
};
var assertChannel = function(value, name) {
  if (!(value instanceof Channel)) {
    throw new ERR_INVALID_ARG_TYPE(name, ["Channel"], value);
  }
};
var tracingChannel = function(nameOrChannels) {
  return new TracingChannel(nameOrChannels);
};
var validateFunction = function(callable, field) {
  if (typeof callable !== "function") {
    throw new ERR_INVALID_ARG_TYPE(field, "Function", callable);
  }
  return callable;
};
var $;
var SafeMap = Map;
var SafeFinalizationRegistry = FinalizationRegistry;
var ArrayPrototypeAt = (array, index) => array[index];
var ArrayPrototypeIndexOf = (array, value) => array.indexOf(value);
var ArrayPrototypePush = (array, value) => array.push(value);
var ArrayPrototypeSplice = (array, start, deleteCount) => array.splice(start, deleteCount);
var ObjectGetPrototypeOf = Object.getPrototypeOf;
var ObjectSetPrototypeOf = Object.setPrototypeOf;
var SymbolHasInstance = Symbol.hasInstance;
var ReflectApply = @getByIdDirect(Reflect, "apply");
var PromiseResolve = @Promise.resolve;
var PromiseReject = @Promise.reject;
var PromisePrototypeThen = (promise, onFulfilled, onRejected) => promise.then(onFulfilled, onRejected);

class WeakReference extends WeakRef {
  constructor() {
    super(...arguments);
  }
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

class WeakRefMap extends SafeMap {
  constructor() {
    super(...arguments);
  }
  #finalizers = new SafeFinalizationRegistry((key) => {
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

class ActiveChannel {
  subscribe(subscription) {
    validateFunction(subscription, "subscription");
    ArrayPrototypePush(this._subscribers, subscription);
    channels.incRef(this.name);
  }
  unsubscribe(subscription) {
    const index = ArrayPrototypeIndexOf(this._subscribers, subscription);
    if (index === -1)
      return false;
    ArrayPrototypeSplice(this._subscribers, index, 1);
    channels.decRef(this.name);
    maybeMarkInactive(this);
    return true;
  }
  bindStore(store, transform) {
    const replacing = this._stores.has(store);
    if (!replacing)
      channels.incRef(this.name);
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
    for (let i = 0;i < (this._subscribers?.length || 0); i++) {
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
      return ReflectApply(fn, thisArg, args);
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
    this._subscribers = @undefined;
    this._stores = @undefined;
    this.name = name;
    channels.set(name, this);
  }
  static [SymbolHasInstance](instance) {
    const prototype = ObjectGetPrototypeOf(instance);
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
  publish() {
  }
  runStores(data, fn, thisArg, ...args) {
    return ReflectApply(fn, thisArg, args);
  }
}
var channels = new WeakRefMap;
var traceEvents = ["start", "end", "asyncStart", "asyncEnd", "error"];

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
      if (!handlers[name])
        continue;
      this[name]?.subscribe(handlers[name]);
    }
  }
  unsubscribe(handlers) {
    let done = true;
    for (const name of traceEvents) {
      if (!handlers[name])
        continue;
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
        const result = ReflectApply(fn, thisArg, args);
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
      asyncEnd.publish(context);
      return PromiseReject(err);
    }
    function resolve(result) {
      context.result = result;
      asyncStart.publish(context);
      asyncEnd.publish(context);
      return result;
    }
    return start.runStores(context, () => {
      try {
        let promise = ReflectApply(fn, thisArg, args);
        if (!(promise instanceof @Promise)) {
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
      asyncStart.runStores(context, () => {
        try {
          if (callback) {
            return ReflectApply(callback, this, arguments);
          }
        } finally {
          asyncEnd.publish(context);
        }
      });
    }
    const callback = ArrayPrototypeAt(args, position);
    if (typeof callback !== "function") {
      throw new ERR_INVALID_ARG_TYPE("callback", ["function"], callback);
    }
    ArrayPrototypeSplice(args, position, 1, wrappedCallback);
    return start.runStores(context, () => {
      try {
        return ReflectApply(fn, thisArg, args);
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

class ERR_INVALID_ARG_TYPE extends TypeError {
  constructor(name, expected, actual) {
    super(`The ${name} argument must be of type ${expected}. Received type ${typeof actual}`);
    this.code = "ERR_INVALID_ARG_TYPE";
  }
}
$ = {
  channel,
  hasSubscribers,
  subscribe,
  tracingChannel,
  unsubscribe,
  Channel
};
return $})
