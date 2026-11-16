// https://wicg.github.io/observable/
const core = require("internal/desktop/dom/core");

type Observer = { next(value: unknown): void; error(error: unknown): void; complete(): void };
type Subscribe = (subscriber: Subscriber) => void;

const { realm } = core;
const internal = Symbol();
const nothing = () => {};
const report = (error: unknown) => core.reportError(null, error);
const isActive = () => !realm.page?.isDisposed;

function callable(value: unknown): Function {
  if (!$isCallable(value)) throw new TypeError("The provided callback is not a function.");
  return value as Function;
}

function dictionary(value: any): any {
  if (value != null && !$isObject(value)) throw new TypeError("The provided value is not a dictionary.");
  return value ?? {};
}

function signalOf(options: any): AbortSignal | undefined {
  const { signal } = dictionary(options);
  if (signal !== undefined && !$isAbortSignal(signal)) throw new TypeError("The signal is not an 'AbortSignal'.");
  return signal;
}

function callbacksOf(value: any, names: string[]): Record<string, Function | undefined> {
  if ($isCallable(value)) return { next: value };
  const given = dictionary(value);
  return Object.fromEntries(
    names.map(name => [name, given[name]]).map(([name, it]) => [name, it === undefined ? it : callable(it)]),
  );
}

function reporting(run: Function, ...values: unknown[]) {
  try {
    run(...values);
  } catch (error) {
    report(error);
  }
}

function countOf(value: any): number {
  const number = Math.trunc(+value);
  return Number.isFinite(number) ? (number < 0 ? 2 ** 64 + number : number) : 0;
}

let join: (subscriber: Subscriber, observer: Observer, signal: AbortSignal | undefined) => void;

class Subscriber {
  #observers: Observer[] = [];
  #teardowns: Function[] = [];
  #controller = new AbortController();
  #isActive = true;

  constructor(key: symbol | undefined = undefined) {
    if (key !== internal) core.illegalConstructor();
  }

  static {
    join = (subscriber, observer, signal) => {
      subscriber.#observers.push(observer);
      if (signal === undefined) return;
      const leave = () => {
        if (!subscriber.#isActive) return;
        subscriber.#observers = subscriber.#observers.filter(it => it !== observer);
        if (subscriber.#observers.length === 0) subscriber.#close(signal.reason);
      };
      if (signal.aborted) leave();
      else $addAbortAlgorithmToSignal(signal, leave);
    };
  }

  #close(reason?: unknown) {
    if (!this.#isActive) return;
    this.#isActive = false;
    this.#controller.abort(reason);
    for (const teardown of this.#teardowns.splice(0).reverse()) if (isActive()) reporting(teardown);
  }

  next(value: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (this.#isActive && isActive()) for (const observer of [...this.#observers]) observer.next(value);
  }
  error(error: unknown) {
    if ($argumentCount() < 1) core.tooFew(1);
    if (!this.#isActive) return report(error);
    if (!isActive()) return;
    this.#close(error);
    for (const observer of this.#observers.splice(0)) observer.error(error);
  }
  complete() {
    if (!this.#isActive || !isActive()) return;
    this.#close();
    for (const observer of this.#observers.splice(0)) observer.complete();
  }
  addTeardown(teardown: Function) {
    callable(teardown);
    if (!isActive()) return;
    if (this.#isActive) this.#teardowns.push(teardown);
    else reporting(teardown);
  }
  get active() {
    return this.#isActive;
  }
  get signal() {
    return this.#controller.signal;
  }
}
core.expose(Subscriber);

function methodOf(value: any, key: PropertyKey): Function | undefined {
  const method = value[key];
  return method == null ? undefined : callable(method);
}

function iteratorOf(value: any, method: Function | undefined): [iterator: any, next: Function] {
  const iterator = callable(method).$call(value);
  if (!$isObject(iterator)) throw new TypeError("The iterator is not an object.");
  return [iterator, iterator.next];
}

function resultOf(result: any) {
  if (!$isObject(result)) throw new TypeError("Expected next() to return an object.");
  return result;
}

function fromIterable(value: any): Subscribe {
  return subscriber => {
    if (!subscriber.active) return;
    const [iterator, next] = iteratorOf(value, methodOf(value, Symbol.iterator));
    if (!subscriber.active) return;
    let isDone = false;
    $addAbortAlgorithmToSignal(subscriber.signal, () => {
      if (isDone) return;
      reporting(() => {
        const close = methodOf(iterator, "return");
        if (close !== undefined && !$isObject(close.$call(iterator)))
          throw new TypeError("Expected return() to return an object.");
      });
    });
    while (subscriber.active) {
      isDone = true;
      const result = resultOf(next.$call(iterator));
      if (result.done) return subscriber.complete();
      const item = result.value;
      isDone = false;
      subscriber.next(item);
    }
  };
}

function fromAsyncIterable(value: any): Subscribe {
  return subscriber => {
    if (!subscriber.active) return;
    const method = methodOf(value, Symbol.asyncIterator);
    const [iterator] = iteratorOf(value, method ?? methodOf(value, Symbol.iterator));
    if (!subscriber.active) return;
    let isDone = false;
    $addAbortAlgorithmToSignal(subscriber.signal, () => {
      if (isDone) return;
      Promise.$resolve(
        Promise.try(() => methodOf(iterator, "return")?.$call(iterator, subscriber.signal.reason) ?? {}),
      ).then(result => {
        if (!$isObject(result)) throw new TypeError("Expected return() to return an object.");
      });
    });
    const fail = (error: unknown) => {
      isDone = true;
      subscriber.error(error);
    };
    let next: Function | undefined;
    const step = () => {
      if (!subscriber.active) return;
      let promise;
      try {
        promise = Promise.$resolve((next ??= iterator.next)!.$call(iterator));
      } catch (error) {
        promise = Promise.$reject(error);
      }
      promise.then(result => {
        let item;
        try {
          if ((isDone = !!resultOf(result).done)) return subscriber.complete();
          item = result.value;
        } catch (error) {
          return fail(error);
        }
        subscriber.next(item);
        step();
      }, fail);
    };
    step();
  };
}

let subscribe: (source: Observable, observer: Observer, signal?: AbortSignal) => void;

function from(value: any): Observable {
  if (!$isObject(value)) throw new TypeError("Cannot convert value to an Observable.");
  if (isObservable(value)) return value as any;
  if (methodOf(value, Symbol.asyncIterator) !== undefined) return new Observable(fromAsyncIterable(value));
  if (methodOf(value, Symbol.iterator) !== undefined) return new Observable(fromIterable(value));
  if (!$isPromise(value)) throw new TypeError("Cannot convert value to an Observable.");
  return new Observable(subscriber => {
    value.$then(
      result => {
        subscriber.next(result);
        subscriber.complete();
      },
      error => subscriber.error(error),
    );
  });
}

const forwarding = (subscriber: Subscriber): Observer => ({
  next: value => subscriber.next(value),
  error: error => subscriber.error(error),
  complete: () => subscriber.complete(),
});

/** What `make` leaves out is passed on. */
function operator(source: Observable, make: (subscriber: Subscriber) => Partial<Observer> | null) {
  return new Observable(subscriber => {
    const own = make(subscriber);
    if (own !== null) subscribe(source, { ...forwarding(subscriber), ...own }, subscriber.signal);
  });
}

function guarded(subscriber: Subscriber, run: (value: unknown, index: number) => void) {
  let index = 0;
  return (value: unknown) => {
    try {
      run(value, index++);
    } catch (error) {
      subscriber.error(error);
    }
  };
}

type Settle = { resolve(value: unknown): void; reject(error: unknown): void };

/** `next` gets what settles the promise and unsubscribes. */
function consume(
  source: Observable,
  options: any,
  next: (value: any, index: number, finish: (result: unknown) => void) => void,
  complete: (settle: Settle) => void,
) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const given = signalOf(options);
  const controller = new AbortController();
  const signal = given === undefined ? controller.signal : AbortSignal.any([controller.signal, given]);
  if (signal.aborted) {
    reject(signal.reason);
    return promise;
  }
  $addAbortAlgorithmToSignal(signal, () => reject(signal.reason));
  let index = 0;
  const finish = (result: unknown) => {
    resolve(result);
    controller.abort();
  };
  const each = (value: unknown) => {
    try {
      next(value, index++, finish);
    } catch (error) {
      reject(error);
      controller.abort(error);
    }
  };
  subscribe(source, { next: each, error: reject, complete: () => complete({ resolve, reject }) }, signal);
  return promise;
}

let isObservable: (value: object) => boolean;

class Observable {
  #start: Function;
  #subscriber: Subscriber | null = null;

  constructor(callback: Subscribe) {
    this.#start = callable(callback);
  }

  static {
    isObservable = value => #start in value;
    subscribe = (source, observer, signal) => {
      if (!isActive()) return;
      if (source.#subscriber?.active) return join(source.#subscriber, observer, signal);
      const subscriber = (source.#subscriber = new Subscriber(internal));
      realm.page?.mirror?.adopt(subscriber);
      join(subscriber, observer, signal);
      try {
        source.#start.$call(undefined, subscriber);
      } catch (error) {
        subscriber.error(error);
      }
    };
  }

  static from(value: unknown) {
    return from(value);
  }

  subscribe(observer: any = {}, options: any = {}) {
    const { next, error, complete } = callbacksOf(observer, ["complete", "error", "next"]);
    const own = {
      next: next ? value => reporting(next, value) : nothing,
      error: error ? value => reporting(error, value) : report,
      complete: complete ? () => reporting(complete) : nothing,
    };
    subscribe(this, own, signalOf(options));
  }

  takeUntil(value: unknown) {
    const notifier = from(value);
    return operator(this, subscriber => {
      const stop = () => subscriber.complete();
      subscribe(notifier, { next: stop, error: stop, complete: nothing }, subscriber.signal);
      return subscriber.active ? {} : null;
    });
  }
  map(mapper: Function) {
    callable(mapper);
    return operator(this, subscriber => ({
      next: guarded(subscriber, (value, index) => subscriber.next(mapper(value, index))),
    }));
  }
  filter(predicate: Function) {
    callable(predicate);
    return operator(this, subscriber => ({
      next: guarded(subscriber, (value, index) => predicate(value, index) && subscriber.next(value)),
    }));
  }
  take(amount: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    amount = countOf(amount);
    return operator(this, subscriber => {
      let left = amount;
      if (left === 0) {
        subscriber.complete();
        return null;
      }
      return {
        next(value) {
          subscriber.next(value);
          if (--left === 0) subscriber.complete();
        },
      };
    });
  }
  drop(amount: number) {
    if ($argumentCount() < 1) core.tooFew(1);
    amount = countOf(amount);
    return operator(this, subscriber => {
      let left = amount;
      return { next: value => (left > 0 ? void left-- : subscriber.next(value)) };
    });
  }
  flatMap(mapper: Function) {
    callable(mapper);
    return operator(this, subscriber => {
      const queue: unknown[] = [];
      let [isBusy, isComplete] = [false, false];
      const innerDone = () => {
        if (queue.length > 0) return open(queue.shift());
        isBusy = false;
        if (isComplete) subscriber.complete();
      };
      const open = guarded(subscriber, (value, index) =>
        subscribe(from(mapper(value, index)), { ...forwarding(subscriber), complete: innerDone }, subscriber.signal),
      );
      return {
        next(value) {
          if (isBusy) return void queue.push(value);
          isBusy = true;
          open(value);
        },
        complete() {
          isComplete = true;
          if (!isBusy) subscriber.complete();
        },
      };
    });
  }
  switchMap(mapper: Function) {
    callable(mapper);
    return operator(this, subscriber => {
      let inner: AbortController | null = null;
      let isComplete = false;
      const innerDone = () => (isComplete ? subscriber.complete() : void (inner = null));
      return {
        next: guarded(subscriber, (value, index) => {
          inner?.abort();
          const { signal } = (inner = new AbortController());
          const mapped = from(mapper(value, index));
          subscribe(
            mapped,
            { ...forwarding(subscriber), complete: innerDone },
            AbortSignal.any([signal, subscriber.signal]),
          );
        }),
        complete() {
          isComplete = true;
          if (inner === null) subscriber.complete();
        },
      };
    });
  }
  inspect(inspector: any = {}) {
    const given = callbacksOf(inspector, ["abort", "complete", "error", "next", "subscribe"]);
    return operator(this, subscriber => {
      given.subscribe?.();
      let { abort } = given;
      if (abort)
        $addAbortAlgorithmToSignal(subscriber.signal, () => abort && reporting(abort, subscriber.signal.reason));
      const tap =
        (name: keyof Observer) =>
        (...values: [unknown]) => {
          if (name !== "next") abort = undefined;
          try {
            given[name]?.(...values);
          } catch (error) {
            abort = undefined;
            return subscriber.error(error);
          }
          subscriber[name](...values);
        };
      return { next: tap("next"), error: tap("error"), complete: tap("complete") as () => void };
    });
  }
  catch(callback: Function) {
    callable(callback);
    return operator(this, subscriber => ({
      error: guarded(subscriber, error => subscribe(from(callback(error)), forwarding(subscriber), subscriber.signal)),
    }));
  }
  finally(callback: Function) {
    callable(callback);
    return operator(this, subscriber => {
      subscriber.addTeardown(callback);
      return {};
    });
  }
}

const empty = () => new RangeError("No values in Observable");
const consumers = {
  toArray(this: Observable, options: any = {}) {
    const all: unknown[] = [];
    return consume(
      this,
      options,
      value => void all.push(value),
      it => it.resolve(all),
    );
  },
  forEach(this: Observable, callback: Function, options: any = {}) {
    callable(callback);
    return consume(
      this,
      options,
      (value, index) => callback(value, index),
      it => it.resolve(undefined),
    );
  },
  every(this: Observable, predicate: Function, options: any = {}) {
    callable(predicate);
    return consume(
      this,
      options,
      (value, index, finish) => predicate(value, index) || finish(false),
      it => it.resolve(true),
    );
  },
  first(this: Observable, options: any = {}) {
    return consume(
      this,
      options,
      (value, _, finish) => finish(value),
      it => it.reject(empty()),
    );
  },
  last(this: Observable, options: any = {}) {
    let last: unknown[] = [];
    return consume(
      this,
      options,
      value => void (last = [value]),
      it => (last.length > 0 ? it.resolve(last[0]) : it.reject(empty())),
    );
  },
  find(this: Observable, predicate: Function, options: any = {}) {
    callable(predicate);
    return consume(
      this,
      options,
      (value, index, finish) => predicate(value, index) && finish(value),
      it => it.resolve(undefined),
    );
  },
  some(this: Observable, predicate: Function, options: any = {}) {
    callable(predicate);
    return consume(
      this,
      options,
      (value, index, finish) => predicate(value, index) && finish(true),
      it => it.resolve(false),
    );
  },
  reduce(this: Observable, reducer: Function, initialValue: unknown = undefined, options: any = {}) {
    callable(reducer);
    let sum = initialValue === undefined ? [] : [initialValue];
    return consume(
      this,
      options,
      (value, index) => void (sum = [sum.length > 0 ? reducer(sum[0], value, index) : value]),
      it =>
        sum.length > 0
          ? it.resolve(sum[0])
          : it.reject(new TypeError("Reduce of empty Observable with no initial value")),
    );
  },
};
for (const name in consumers) {
  const run = consumers[name];
  const { [name]: method } = {
    [name]() {
      try {
        if (!$isObject(this) || !isObservable(this)) throw new TypeError("Illegal invocation");
        return run.$apply(this, arguments);
      } catch (error) {
        return Promise.$reject(error);
      }
    },
  };
  Object.defineProperty(method, "length", { value: run.length });
  Object.defineProperty(Observable.prototype, name, {
    value: method,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
core.expose(Observable);

function when(target: any, type: string, options: any, addEventListener: Function) {
  const { capture, passive } = dictionary(options);
  return new Observable(subscriber => {
    if (!subscriber.active) return;
    addEventListener.$call(target, type, event => subscriber.next(event), {
      capture,
      passive,
      signal: subscriber.signal,
    });
  });
}

export default { Observable, Subscriber, when };
