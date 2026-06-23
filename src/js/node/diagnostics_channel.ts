// Hardcoded module "node:diagnostics_channel"
// Reference: https://github.com/nodejs/node/blob/v26.3.0/lib/diagnostics_channel.js

const { validateFunction } = require("internal/validators");

const SafeMap = Map;
const SafeFinalizationRegistry = FinalizationRegistry;

const ArrayPrototypeAt = Array.prototype.at;
const ArrayPrototypeIndexOf = Array.prototype.indexOf;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;
const ArrayPrototypeSplice = Array.prototype.splice;
const ObjectDefineProperty = Object.defineProperty;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectSetPrototypeOf = Object.setPrototypeOf;
const PromisePrototypeThen = Promise.prototype.then;
const PromiseReject = Promise.$reject.bind(Promise);
const SymbolDispose = Symbol.dispose;
const SymbolHasInstance = Symbol.hasInstance;

// Mirrors Node's native WeakReference (src/node_util.h): the target is held
// strongly while the ref count is non-zero (an active subscription must keep
// its channel alive), and only weakly once it drops back to zero.
class WeakReference<T extends WeakKey> {
  #weak: WeakRef<T>;
  #strong: T | undefined = undefined;
  #refs = 0;

  constructor(value: T) {
    this.#weak = new WeakRef(value);
  }

  get() {
    return this.#strong ?? this.#weak.deref();
  }

  incRef() {
    this.#refs++;
    if (this.#refs === 1) this.#strong = this.#weak.deref();
    return this.#refs;
  }

  decRef() {
    this.#refs--;
    if (this.#refs === 0) this.#strong = undefined;
    return this.#refs;
  }
}

// Can't delete when weakref count reaches 0 as it could increment again.
// Only GC can be used as a valid time to clean up the channels map.
class WeakRefMap extends SafeMap {
  #finalizers = new SafeFinalizationRegistry(key => {
    // Check that the key doesn't have any value before deleting, as the WeakRef for the key
    // may have been replaced since finalization callbacks aren't synchronous with GC.
    if (!this.has(key)) this.delete(key);
  });

  set(key, value) {
    this.#finalizers.register(value, key);
    return super.set(key, new WeakReference(value));
  }

  get(key) {
    return super.get(key)?.get();
  }

  has(key) {
    return !!this.get(key);
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

class RunStoresScope {
  #stack;

  constructor(activeChannel, data) {
    const stack = new DisposableStack();
    const stores = activeChannel._stores;

    try {
      // Enter stores using withScope
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

      // Publish data
      activeChannel.publish(data);
    } catch (err) {
      stack.dispose();
      throw err;
    }

    // Transfer ownership of the stack
    this.#stack = stack.move();
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
    this._subscribers = ArrayPrototypeSlice.$call(this._subscribers);
    ArrayPrototypePush.$call(this._subscribers, subscription);
    channels.incRef(this.name);
  }

  unsubscribe(subscription) {
    const index = ArrayPrototypeIndexOf.$call(this._subscribers, subscription);
    if (index === -1) return false;

    const before = ArrayPrototypeSlice.$call(this._subscribers, 0, index);
    const after = ArrayPrototypeSlice.$call(this._subscribers, index + 1);
    this._subscribers = before;
    ArrayPrototypePush.$apply(this._subscribers, after);

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
    const subscribers = this._subscribers;
    for (let i = 0; i < (subscribers?.length || 0); i++) {
      try {
        const onMessage = subscribers[i];
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
    const scope = this.withStoreScope(data);
    try {
      return fn.$apply(thisArg, args);
    } finally {
      scope[SymbolDispose]();
    }
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
    if (instance == null) {
      // Node's primordial ObjectGetPrototypeOf throws V8's ToObject error here;
      // match the message since tests assert on it.
      throw new TypeError("Cannot convert undefined or null to object");
    }
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
    // Return no-op disposable for inactive channels
    return {
      [SymbolDispose]() {},
    };
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
    throw $ERR_INVALID_ARG_TYPE(name, "instance of Channel", value);
  }
}

function emitNonThenableWarning(fn) {
  process.emitWarning(
    `tracePromise was called with the function '${fn.name || "<anonymous>"}', ` + "which returned a non-thenable.",
  );
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

  throw $ERR_INVALID_ARG_TYPE("nameOrChannels", `string or an instance of ${className} or Object`, nameOrChannels);
}

class BoundedChannelScope {
  #context;
  #end;
  #scope;

  constructor(boundedChannel, context) {
    // Only proceed if there are subscribers
    if (!boundedChannel.hasSubscribers) {
      return;
    }

    const { start, end } = boundedChannel;
    this.#context = context;
    this.#end = end;

    // Use RunStoresScope for the start channel
    this.#scope = new RunStoresScope(start, context);
  }

  [SymbolDispose]() {
    if (!this.#scope) {
      return;
    }

    // Publish end event
    this.#end.publish(this.#context);

    // Dispose the start scope to restore stores
    this.#scope[SymbolDispose]();
    this.#scope = undefined;
  }
}

class BoundedChannel {
  constructor(nameOrChannels) {
    for (let i = 0; i < boundedEvents.length; ++i) {
      const eventName = boundedEvents[i];
      ObjectDefineProperty.$call(null, this, eventName, {
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
      if (!handlers[name]) continue;

      this[name]?.subscribe(handlers[name]);
    }
  }

  unsubscribe(handlers) {
    let done = true;

    for (let i = 0; i < boundedEvents.length; ++i) {
      const name = boundedEvents[i];
      if (!handlers[name]) continue;

      if (!this[name]?.unsubscribe(handlers[name])) {
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
    // Create a BoundedChannel for start/end (call window)
    if (typeof nameOrChannels === "string") {
      this.#callWindow = new BoundedChannel(nameOrChannels);
      this.#continuationWindow = new BoundedChannel({
        start: channel(`tracing:${nameOrChannels}:asyncStart`),
        end: channel(`tracing:${nameOrChannels}:asyncEnd`),
      });
    } else if (typeof nameOrChannels === "object") {
      this.#callWindow = new BoundedChannel({
        start: nameOrChannels.start,
        end: nameOrChannels.end,
      });
      this.#continuationWindow = new BoundedChannel({
        start: nameOrChannels.asyncStart,
        end: nameOrChannels.asyncEnd,
      });
    }

    // Create individual channel for error
    ObjectDefineProperty.$call(null, this, "error", {
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

    // Subscribe to call window (start/end)
    if (start || end) {
      this.#callWindow.subscribe({ start, end });
    }

    // Subscribe to continuation window (asyncStart/asyncEnd)
    if (asyncStart || asyncEnd) {
      this.#continuationWindow.subscribe({
        start: asyncStart,
        end: asyncEnd,
      });
    }

    // Subscribe to error channel
    if (error) {
      this.error.subscribe(error);
    }
  }

  unsubscribe(handlers) {
    let done = true;
    const { start, end, asyncStart, asyncEnd, error } = handlers;

    // Unsubscribe from call window
    if (start || end) {
      if (!this.#callWindow.unsubscribe({ start, end })) {
        done = false;
      }
    }

    // Unsubscribe from continuation window
    if (asyncStart || asyncEnd) {
      if (
        !this.#continuationWindow.unsubscribe({
          start: asyncStart,
          end: asyncEnd,
        })
      ) {
        done = false;
      }
    }

    // Unsubscribe from error channel
    if (error) {
      if (!this.error.unsubscribe(error)) {
        done = false;
      }
    }

    return done;
  }

  traceSync(fn, context = {}, thisArg, ...args) {
    if (!this.hasSubscribers) {
      return fn.$apply(thisArg, args);
    }

    const { error } = this;

    const scope = this.#callWindow.withScope(context);
    try {
      const result = fn.$apply(thisArg, args);
      context.result = result;
      return result;
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      scope[SymbolDispose]();
    }
  }

  tracePromise(fn, context = {}, thisArg, ...args) {
    if (!this.hasSubscribers) {
      const result = fn.$apply(thisArg, args);
      if (typeof result?.then !== "function") {
        emitNonThenableWarning(fn);
      }
      return result;
    }

    const { error } = this;
    const continuationWindow = this.#continuationWindow;

    function reject(err) {
      context.error = err;
      error.publish(context);
      // Use continuation window for asyncStart/asyncEnd
      const scope = continuationWindow.withScope(context);
      try {
        // TODO: Is there a way to have asyncEnd _after_ the continuation?
        return PromiseReject(err);
      } finally {
        scope[SymbolDispose]();
      }
    }

    function resolve(result) {
      context.result = result;
      // Use continuation window for asyncStart/asyncEnd
      const scope = continuationWindow.withScope(context);
      try {
        // TODO: Is there a way to have asyncEnd _after_ the continuation?
        return result;
      } finally {
        scope[SymbolDispose]();
      }
    }

    const scope = this.#callWindow.withScope(context);
    try {
      const result = fn.$apply(thisArg, args);
      // If the return value is not a thenable, return it directly with a warning.
      // Do not publish to asyncStart/asyncEnd.
      if (typeof result?.then !== "function") {
        emitNonThenableWarning(fn);
        context.result = result;
        return result;
      }
      // For native Promises use PromisePrototypeThen to avoid user overrides.
      if ($isPromise(result)) {
        return PromisePrototypeThen.$call(result, resolve, reject);
      }
      // For custom thenables, call .then() directly to preserve the thenable type.
      return result.then(resolve, reject);
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      scope[SymbolDispose]();
    }
  }

  traceCallback(fn, position = -1, context = {}, thisArg, ...args) {
    if (!this.hasSubscribers) {
      return fn.$apply(thisArg, args);
    }

    const { error } = this;
    const continuationWindow = this.#continuationWindow;

    function wrappedCallback(err, res) {
      if (err) {
        context.error = err;
        error.publish(context);
      } else {
        context.result = res;
      }

      // Use continuation window for asyncStart/asyncEnd around callback
      const scope = continuationWindow.withScope(context);
      try {
        return callback.$apply(this, arguments);
      } finally {
        scope[SymbolDispose]();
      }
    }

    const callback = ArrayPrototypeAt.$call(args, position);
    validateFunction(callback, "callback");
    ArrayPrototypeSplice.$call(args, position, 1, wrappedCallback);

    const scope = this.#callWindow.withScope(context);
    try {
      return fn.$apply(thisArg, args);
    } catch (err) {
      context.error = err;
      error.publish(context);
      throw err;
    } finally {
      scope[SymbolDispose]();
    }
  }
}

function tracingChannel(nameOrChannels) {
  return new TracingChannel(nameOrChannels);
}

// The module loaders cannot afford to load this module just to discover that
// nobody subscribed, so hand them the "module.require" / "module.import"
// tracing channels once this module is loaded (in Node the CJS and ESM
// loaders own these channels instead).
{
  const moduleTracing = require("internal/module_tracing");
  moduleTracing.requireChannel = tracingChannel("module.require");
  moduleTracing.importChannel = tracingChannel("module.import");
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
