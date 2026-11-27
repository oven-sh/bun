// Mock basique de diagnostics_channel pour Bun-Elixir
class Channel {
  constructor(name) {
    this.name = name;
    this.subscribers = [];
  }

  get hasSubscribers() {
    return this.subscribers.length > 0;
  }

  publish(data) {
    for (const subscriber of this.subscribers) {
      try {
        subscriber(data, this.name);
      } catch (err) {
        // Propager via nextTick pour éviter de bloquer le diffuseur
        if (typeof process !== 'undefined' && typeof process.nextTick === 'function') {
          process.nextTick(() => { throw err; });
        } else {
          Promise.resolve().then(() => { throw err; });
        }
      }
    }
  }

  subscribe(callback) {
    this.subscribers.push(callback);
  }

  unsubscribe(callback) {
    const index = this.subscribers.indexOf(callback);
    if (index !== -1) {
      this.subscribers.splice(index, 1);
      return true;
    }
    return false;
  }
}

const channels = new Map();

function channel(name) {
  if (typeof name !== 'string' && typeof name !== 'symbol') {
    throw new TypeError('The "name" argument must be of type string or symbol.');
  }
  let chan = channels.get(name);
  if (!chan) {
    chan = new Channel(name);
    channels.set(name, chan);
  }
  return chan;
}

function hasSubscribers(name) {
  const chan = channels.get(name);
  return chan ? chan.hasSubscribers : false;
}

function subscribe(name, callback) {
  return channel(name).subscribe(callback);
}

function unsubscribe(name, callback) {
  return channel(name).unsubscribe(callback);
}

class TracingChannel {
  constructor(name) {
    this.name = name;
    this.start = channel(`tracing:${name}:start`);
    this.end = channel(`tracing:${name}:end`);
    this.asyncStart = channel(`tracing:${name}:asyncStart`);
    this.asyncEnd = channel(`tracing:${name}:asyncEnd`);
    this.error = channel(`tracing:${name}:error`);
  }

  subscribe(subscribers) {
    if (subscribers.start) this.start.subscribe(subscribers.start);
    if (subscribers.end) this.end.subscribe(subscribers.end);
    if (subscribers.asyncStart) this.asyncStart.subscribe(subscribers.asyncStart);
    if (subscribers.asyncEnd) this.asyncEnd.subscribe(subscribers.asyncEnd);
    if (subscribers.error) this.error.subscribe(subscribers.error);
  }

  unsubscribe(subscribers) {
    let result = true;
    if (subscribers.start) result = this.start.unsubscribe(subscribers.start) && result;
    if (subscribers.end) result = this.end.unsubscribe(subscribers.end) && result;
    if (subscribers.asyncStart) result = this.asyncStart.unsubscribe(subscribers.asyncStart) && result;
    if (subscribers.asyncEnd) result = this.asyncEnd.unsubscribe(subscribers.asyncEnd) && result;
    if (subscribers.error) result = this.error.unsubscribe(subscribers.error) && result;
    return result;
  }

  traceSync(fn, context = {}, thisArg, ...args) {
    this.start.publish(context);
    try {
      const result = Reflect.apply(fn, thisArg, args);
      this.end.publish(context);
      return result;
    } catch (err) {
      this.error.publish({ error: err });
      this.end.publish(context);
      throw err;
    }
  }

  tracePromise(fn, context = {}, thisArg, ...args) {
    this.start.publish(context);
    try {
      const promise = Reflect.apply(fn, thisArg, args);
      return Promise.resolve(promise).then(
        (val) => {
          this.end.publish(context);
          return val;
        },
        (err) => {
          this.error.publish({ error: err });
          this.end.publish(context);
          throw err;
        }
      );
    } catch (err) {
      this.error.publish({ error: err });
      this.end.publish(context);
      throw err;
    }
  }

  traceCallback(fn, position = 0, context = {}, thisArg, ...args) {
    this.start.publish(context);
    const originalCb = args[position];
    if (typeof originalCb === 'function') {
      args[position] = function(...cbArgs) {
        this.end.publish(context);
        return originalCb.apply(this, cbArgs);
      }.bind(thisArg);
    }
    try {
      return Reflect.apply(fn, thisArg, args);
    } catch (err) {
      this.error.publish({ error: err });
      this.end.publish(context);
      throw err;
    }
  }
}

function tracingChannel(name) {
  return new TracingChannel(name);
}

module.exports = {
  Channel,
  channel,
  hasSubscribers,
  subscribe,
  unsubscribe,
  TracingChannel,
  tracingChannel
};
