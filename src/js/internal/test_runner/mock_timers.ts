// Port of Node.js lib/internal/test_runner/mock/mock_timers.js (v26.3.0)
// and its dependency lib/internal/priority_queue.js.
// API reference: https://nodejs.org/api/test.html#class-mocktimers

const {
  validateAbortSignal,
  validateNumber,
  validateString,
  validateArray,
  validateUint32,
} = require("internal/validators");
const { addAbortListener } = require("internal/abort_listener");

const nodeTimers = require("node:timers");

interface MockableTimers {
  setTimeout: unknown;
  setInterval: unknown;
  setImmediate: unknown;
  clearTimeout: unknown;
  clearInterval: unknown;
  clearImmediate: unknown;
}
const nodeTimersPromises = require("node:timers/promises");
const EventEmitter = require("node:events");

const DatePrototypeGetTime = Date.prototype.getTime;
const FunctionPrototypeToString = Function.prototype.toString;

// require('internal/timers').TIMEOUT_MAX in Node
const TIMEOUT_MAX = 2 ** 31 - 1;

// The PriorityQueue is a basic implementation of a binary heap that accepts
// a custom sorting function via its constructor. This function is passed
// the two nodes to compare, similar to the native Array#sort. Crucially
// this enables priority queues that are based on a comparison of more than
// just a single criteria.
class PriorityQueue<T> {
  #compare: (a: T, b: T) => number = (a, b) => (a as number) - (b as number);
  #heap: any[] = [undefined, undefined];
  #setPosition: ((node: T, pos: number) => void) | undefined;
  #size = 0;

  constructor(comparator?: (a: T, b: T) => number, setPosition?: (node: T, pos: number) => void) {
    if (comparator !== undefined) this.#compare = comparator;
    if (setPosition !== undefined) this.#setPosition = setPosition;
  }

  insert(value: T) {
    const heap = this.#heap;
    const pos = ++this.#size;
    heap[pos] = value;

    this.percolateUp(pos);
  }

  peek(): T | undefined {
    return this.#heap[1];
  }

  peekBottom(): T | undefined {
    return this.#heap[this.#size];
  }

  percolateDown(pos: number) {
    const compare = this.#compare;
    const setPosition = this.#setPosition;
    const hasSetPosition = setPosition !== undefined;
    const heap = this.#heap;
    const size = this.#size;
    const hsize = size >> 1;
    const item = heap[pos];

    while (pos <= hsize) {
      let child = pos << 1;
      const nextChild = child + 1;
      let childItem = heap[child];

      if (nextChild <= size && compare(heap[nextChild], childItem) < 0) {
        child = nextChild;
        childItem = heap[nextChild];
      }

      if (compare(item, childItem) <= 0) break;

      if (hasSetPosition) setPosition(childItem, pos);

      heap[pos] = childItem;
      pos = child;
    }

    heap[pos] = item;
    if (hasSetPosition) setPosition(item, pos);
  }

  percolateUp(pos: number) {
    const heap = this.#heap;
    const compare = this.#compare;
    const setPosition = this.#setPosition;
    const hasSetPosition = setPosition !== undefined;
    const item = heap[pos];

    while (pos > 1) {
      const parent = pos >> 1;
      const parentItem = heap[parent];
      if (compare(parentItem, item) <= 0) break;
      heap[pos] = parentItem;
      if (hasSetPosition) setPosition(parentItem, pos);
      pos = parent;
    }

    heap[pos] = item;
    if (hasSetPosition) setPosition(item, pos);
  }

  removeAt(pos: number) {
    const heap = this.#heap;
    let size = this.#size;
    heap[pos] = heap[size];
    heap[size] = undefined;
    size = --this.#size;

    if (size > 0 && pos <= size) {
      if (pos > 1 && this.#compare(heap[pos >> 1], heap[pos]) > 0) this.percolateUp(pos);
      else this.percolateDown(pos);
    }
  }

  shift(): T | undefined {
    const heap = this.#heap;
    const value = heap[1];
    if (value === undefined) return;

    this.removeAt(1);

    return value;
  }
}

function validateStringArray(value: string[], name: string) {
  validateArray(value, name);
  for (let i = 0; i < value.length; i++) {
    validateString(value[i], `${name}[${i}]`);
  }
}

// Internal reference to the MockTimers class inside MockDate
let kMock: symbol;
// Initial epoch to which #now should be set to
const kInitialEpoch = 0;

function compareTimersLists(a: Timeout, b: Timeout) {
  return a.runAt - b.runAt || a.id - b.id;
}

function setPosition(node: Timeout, pos: number) {
  node.priorityQueuePosition = pos;
}

function abortIt(signal: AbortSignal) {
  return $makeAbortError(undefined, { cause: signal.reason });
}

const SUPPORTED_APIS = ["setTimeout", "setInterval", "setImmediate", "Date", "scheduler.wait", "AbortSignal.timeout"];
const TIMERS_DEFAULT_INTERVAL = {
  __proto__: null,
  setImmediate: -1,
};

type TimerCallback = (...args: any[]) => void;

interface TimeoutOptions {
  __proto__?: null;
  id: number;
  callback: TimerCallback;
  runAt: number;
  interval: number | undefined;
  args: unknown[];
  clear: (timer: Timeout) => void;
}

interface PromisifiedTimerOptions {
  signal?: AbortSignal;
}

class Timeout {
  #clear: (timer: Timeout) => void;
  id: number;
  callback: TimerCallback;
  runAt: number;
  interval: number | undefined;
  args: unknown[];
  priorityQueuePosition: number | undefined;

  constructor(opts: TimeoutOptions) {
    this.id = opts.id;
    this.callback = opts.callback;
    this.runAt = opts.runAt;
    this.interval = opts.interval;
    this.args = opts.args;
    this.#clear = opts.clear;
  }

  hasRef() {
    return true;
  }

  ref() {
    return this;
  }

  unref() {
    return this;
  }

  refresh() {
    return this;
  }

  close() {
    this.#clear(this);
    return this;
  }

  [Symbol.dispose]() {
    this.#clear(this);
  }
}

class MockTimers {
  #realSetTimeout;
  #realClearTimeout;
  #realSetInterval;
  #realClearInterval;
  #realSetImmediate;
  #realClearImmediate;

  #realPromisifiedSetTimeout;
  #realPromisifiedSetInterval;
  #realTimersPromisifiedSchedulerWait!: (delay: number, options?: PromisifiedTimerOptions) => Promise<unknown>;

  #realTimersSetTimeout;
  #realTimersClearTimeout;
  #realTimersSetInterval;
  #realTimersClearInterval;
  #realTimersSetImmediate;
  #realTimersClearImmediate;
  #realPromisifiedSetImmediate;

  #nativeDateDescriptor;
  #realAbortSignalTimeout;

  #timersInContext: string[] = [];
  #isEnabled = false;
  #currentTimer = 1;
  #now = kInitialEpoch;

  #executionQueue = new PriorityQueue(compareTimersLists, setPosition);

  #setTimeout = this.#createTimer.bind(this, false);
  #clearTimeout = this.#clearTimer.bind(this);
  #setInterval = this.#createTimer.bind(this, true);
  #clearInterval = this.#clearTimer.bind(this);
  #clearImmediate = this.#clearTimer.bind(this);

  #restoreSetImmediate() {
    Object.defineProperty(globalThis, "setImmediate", this.#realSetImmediate);
    Object.defineProperty(globalThis, "clearImmediate", this.#realClearImmediate);
    Object.defineProperty(nodeTimers, "setImmediate", this.#realTimersSetImmediate);
    Object.defineProperty(nodeTimers, "clearImmediate", this.#realTimersClearImmediate);
    Object.defineProperty(nodeTimersPromises, "setImmediate", this.#realPromisifiedSetImmediate);
  }

  #restoreOriginalSetInterval() {
    Object.defineProperty(globalThis, "setInterval", this.#realSetInterval);
    Object.defineProperty(globalThis, "clearInterval", this.#realClearInterval);
    Object.defineProperty(nodeTimers, "setInterval", this.#realTimersSetInterval);
    Object.defineProperty(nodeTimers, "clearInterval", this.#realTimersClearInterval);
    Object.defineProperty(nodeTimersPromises, "setInterval", this.#realPromisifiedSetInterval);
  }

  #restoreOriginalSchedulerWait() {
    nodeTimersPromises.scheduler.wait = this.#realTimersPromisifiedSchedulerWait.bind(this);
  }

  #restoreOriginalSetTimeout() {
    Object.defineProperty(globalThis, "setTimeout", this.#realSetTimeout);
    Object.defineProperty(globalThis, "clearTimeout", this.#realClearTimeout);
    Object.defineProperty(nodeTimers, "setTimeout", this.#realTimersSetTimeout);
    Object.defineProperty(nodeTimers, "clearTimeout", this.#realTimersClearTimeout);
    Object.defineProperty(nodeTimersPromises, "setTimeout", this.#realPromisifiedSetTimeout);
  }

  #storeOriginalSetImmediate() {
    this.#realSetImmediate = Object.getOwnPropertyDescriptor(globalThis, "setImmediate");
    this.#realClearImmediate = Object.getOwnPropertyDescriptor(globalThis, "clearImmediate");
    this.#realTimersSetImmediate = Object.getOwnPropertyDescriptor(nodeTimers, "setImmediate");
    this.#realTimersClearImmediate = Object.getOwnPropertyDescriptor(nodeTimers, "clearImmediate");
    this.#realPromisifiedSetImmediate = Object.getOwnPropertyDescriptor(nodeTimersPromises, "setImmediate");
  }

  #storeOriginalSetInterval() {
    this.#realSetInterval = Object.getOwnPropertyDescriptor(globalThis, "setInterval");
    this.#realClearInterval = Object.getOwnPropertyDescriptor(globalThis, "clearInterval");
    this.#realTimersSetInterval = Object.getOwnPropertyDescriptor(nodeTimers, "setInterval");
    this.#realTimersClearInterval = Object.getOwnPropertyDescriptor(nodeTimers, "clearInterval");
    this.#realPromisifiedSetInterval = Object.getOwnPropertyDescriptor(nodeTimersPromises, "setInterval");
  }

  #storeOriginalSchedulerWait() {
    this.#realTimersPromisifiedSchedulerWait = nodeTimersPromises.scheduler.wait.bind(this);
  }

  #storeOriginalSetTimeout() {
    this.#realSetTimeout = Object.getOwnPropertyDescriptor(globalThis, "setTimeout");
    this.#realClearTimeout = Object.getOwnPropertyDescriptor(globalThis, "clearTimeout");
    this.#realTimersSetTimeout = Object.getOwnPropertyDescriptor(nodeTimers, "setTimeout");
    this.#realTimersClearTimeout = Object.getOwnPropertyDescriptor(nodeTimers, "clearTimeout");
    this.#realPromisifiedSetTimeout = Object.getOwnPropertyDescriptor(nodeTimersPromises, "setTimeout");
  }

  #storeOriginalAbortSignalTimeout() {
    this.#realAbortSignalTimeout = Object.getOwnPropertyDescriptor(AbortSignal, "timeout");
  }

  #restoreOriginalAbortSignalTimeout() {
    Object.defineProperty(AbortSignal, "timeout", this.#realAbortSignalTimeout);
  }

  #createTimer(isInterval: boolean, callback: TimerCallback, delay: number, ...args: unknown[]) {
    // Only the upper bound is clamped, like Node: `setInterval(fn, 0)` re-fires
    // within one tick() until cleared. Real timers clamp to 1ms; clamping here
    // would diverge from the port.
    if (delay > TIMEOUT_MAX) {
      delay = 1;
    }

    const timerId = this.#currentTimer++;
    const opts: TimeoutOptions = {
      __proto__: null,
      id: timerId,
      callback,
      runAt: this.#now + delay,
      interval: isInterval ? delay : undefined,
      args,
      clear: this.#clearTimeout,
    };

    const timer = new Timeout(opts);
    this.#executionQueue.insert(timer);
    return timer;
  }

  #clearTimer(timer: Timeout | null | undefined) {
    if (timer?.priorityQueuePosition !== undefined) {
      this.#executionQueue.removeAt(timer.priorityQueuePosition);
      timer.priorityQueuePosition = undefined;
      timer.interval = undefined;
    }
  }

  #createDate() {
    kMock ??= Symbol("MockTimers");
    const NativeDateConstructor = this.#nativeDateDescriptor.value;
    if (NativeDateConstructor.isMock) {
      throw $ERR_INVALID_STATE("Date is already being mocked!");
    }
    /**
     * Function to mock the Date constructor, treats cases as per ECMA-262
     * and returns a Date object with a mocked implementation
     */
    function MockDate(year, month, date, hours, minutes, seconds, ms) {
      const mockTimersSource: MockTimers = MockDate[kMock];
      const nativeDate: DateConstructor = mockTimersSource.#nativeDateDescriptor.value;

      // As of the fake-timers implementation for Sinon
      // ref https://github.com/sinonjs/fake-timers/blob/a4c757f80840829e45e0852ea1b17d87a998388e/src/fake-timers-src.js#L456
      // This covers the Date constructor called as a function ref.
      // ECMA-262 Edition 5.1 section 15.9.2.
      // and ECMA-262 Edition 14 Section 21.4.2.1
      // replaces 'this instanceof MockDate' with a more reliable check
      // from ECMA-262 Edition 14 Section 13.3.12.1 NewTarget
      if (!new.target) {
        return new nativeDate(mockTimersSource.#now).toString();
      }

      // Cases where Date is called as a constructor
      // This is intended as a defensive implementation to avoid
      // having unexpected returns
      switch (arguments.length) {
        case 0:
          return new nativeDate(MockDate[kMock].#now);
        case 1:
          return new nativeDate(year);
        case 2:
          return new nativeDate(year, month);
        case 3:
          return new nativeDate(year, month, date);
        case 4:
          return new nativeDate(year, month, date, hours);
        case 5:
          return new nativeDate(year, month, date, hours, minutes);
        case 6:
          return new nativeDate(year, month, date, hours, minutes, seconds);
        default:
          return new nativeDate(year, month, date, hours, minutes, seconds, ms);
      }
    }

    // Prototype is read-only, and non assignable through Object.defineProperties
    // eslint-disable-next-line no-unused-vars -- used to get the prototype out of the object
    const { prototype, ...dateProps } = Object.getOwnPropertyDescriptors(NativeDateConstructor);

    // Binds all the properties of Date to the MockDate function
    Object.defineProperties(MockDate, dateProps);

    MockDate.now = function now() {
      return MockDate[kMock].#now;
    };

    // This is just to print the function { native code } in the console
    // when the user prints the function and not the internal code
    MockDate.toString = function toString() {
      return FunctionPrototypeToString.$call(MockDate[kMock].#nativeDateDescriptor.value);
    };

    Object.defineProperties(MockDate, {
      // @ts-ignore
      __proto__: null,
      [kMock]: {
        __proto__: null,
        enumerable: false,
        configurable: false,
        writable: false,
        value: this,
      },

      isMock: {
        __proto__: null,
        enumerable: true,
        configurable: false,
        writable: false,
        value: true,
      },
    });

    MockDate.prototype = NativeDateConstructor.prototype;
    MockDate.parse = NativeDateConstructor.parse;
    MockDate.UTC = NativeDateConstructor.UTC;
    MockDate.prototype.toUTCString = NativeDateConstructor.prototype.toUTCString;
    return MockDate;
  }

  async *#setIntervalPromisified(interval: number, result: unknown, options?: PromisifiedTimerOptions) {
    const emitter = new EventEmitter();

    let abortListener: Disposable | undefined;
    if (options?.signal) {
      validateAbortSignal(options.signal, "options.signal");

      if (options.signal.aborted) {
        throw abortIt(options.signal);
      }

      abortListener = addAbortListener(options.signal, () => {
        emitter.emit("error", abortIt(options.signal!));
      });
    }

    const eventIt = EventEmitter.on(emitter, "data");
    const timer = this.#createTimer(true, () => emitter.emit("data"), interval, options);

    try {
      // eslint-disable-next-line no-unused-vars
      for await (const event of eventIt) {
        yield result;
      }
    } finally {
      abortListener?.[Symbol.dispose]();
      this.#clearInterval(timer);
    }
  }

  #setImmediate(callback: TimerCallback, ...args: unknown[]) {
    return this.#createTimer(false, callback, TIMERS_DEFAULT_INTERVAL.setImmediate, ...args);
  }

  async #promisifyTimer({
    timerFn,
    clearFn,
    ms,
    result,
    options,
  }: {
    __proto__?: null;
    timerFn: (callback: TimerCallback, ms: number) => Timeout;
    clearFn: (timer: Timeout) => void;
    ms: number;
    result: unknown;
    options: PromisifiedTimerOptions | undefined;
  }) {
    const { promise, resolve, reject } = Promise.withResolvers();

    let abortListener: Disposable | undefined;
    if (options?.signal) {
      validateAbortSignal(options.signal, "options.signal");

      if (options.signal.aborted) {
        throw abortIt(options.signal);
      }

      abortListener = addAbortListener(options.signal, () => {
        reject(abortIt(options.signal!));
      });
    }

    const timer = timerFn(resolve, ms);

    try {
      await promise;
      return result;
    } finally {
      abortListener?.[Symbol.dispose]();
      clearFn(timer);
    }
  }

  #setImmediatePromisified(result?: unknown, options?: PromisifiedTimerOptions) {
    return this.#promisifyTimer({
      __proto__: null,
      timerFn: this.#setImmediate.bind(this),
      clearFn: this.#clearImmediate.bind(this),
      ms: TIMERS_DEFAULT_INTERVAL.setImmediate,
      result,
      options,
    });
  }

  #setTimeoutPromisified(ms: number, result?: unknown, options?: PromisifiedTimerOptions) {
    return this.#promisifyTimer({
      __proto__: null,
      timerFn: this.#setTimeout.bind(this),
      clearFn: this.#clearTimeout.bind(this),
      ms,
      result,
      options,
    });
  }

  #assertTimersAreEnabled() {
    if (!this.#isEnabled) {
      throw $ERR_INVALID_STATE("You should enable MockTimers first by calling the .enable function");
    }
  }

  #assertTimeArg(time: number) {
    if (time < 0) {
      // Node's swapped-arg bug reproduced verbatim (nodejs/node v26.3.0
      // lib/internal/test_runner/mock/mock_timers.js:558).
      throw $ERR_INVALID_ARG_VALUE("time", "positive integer", `${time}`);
    }
  }

  #isValidDateWithGetTime(maybeDate: unknown) {
    // Validation inspired on https://github.com/inspect-js/is-date-object/blob/main/index.js#L3-L11
    try {
      DatePrototypeGetTime.$call(maybeDate);
      return true;
    } catch {
      return false;
    }
  }

  #toggleEnableTimers(activate: boolean) {
    const options = {
      __proto__: null,
      toFake: {
        "__proto__": null,
        "scheduler.wait": () => {
          this.#storeOriginalSchedulerWait();

          nodeTimersPromises.scheduler.wait = (delay, options) =>
            this.#setTimeoutPromisified(delay, undefined, options);
        },
        "setTimeout": () => {
          this.#storeOriginalSetTimeout();

          (globalThis as unknown as MockableTimers).setTimeout = this.#setTimeout;
          (globalThis as unknown as MockableTimers).clearTimeout = this.#clearTimeout;

          (nodeTimers as MockableTimers).setTimeout = this.#setTimeout;
          (nodeTimers as MockableTimers).clearTimeout = this.#clearTimeout;

          (nodeTimersPromises as Pick<MockableTimers, "setTimeout">).setTimeout =
            this.#setTimeoutPromisified.bind(this);
        },
        "setInterval": () => {
          this.#storeOriginalSetInterval();

          (globalThis as unknown as MockableTimers).setInterval = this.#setInterval;
          (globalThis as unknown as MockableTimers).clearInterval = this.#clearInterval;

          (nodeTimers as MockableTimers).setInterval = this.#setInterval;
          (nodeTimers as MockableTimers).clearInterval = this.#clearInterval;

          (nodeTimersPromises as Pick<MockableTimers, "setInterval">).setInterval =
            this.#setIntervalPromisified.bind(this);
        },
        "setImmediate": () => {
          this.#storeOriginalSetImmediate();

          // setImmediate functions needs to bind MockTimers
          // otherwise it will throw an error when called
          // "Receiver must be an instance of MockTimers"
          // because #setImmediate is the only function here
          // that calls #createTimer and it's not bound to MockTimers
          (globalThis as unknown as MockableTimers).setImmediate = this.#setImmediate.bind(this);
          (globalThis as unknown as MockableTimers).clearImmediate = this.#clearImmediate;

          (nodeTimers as MockableTimers).setImmediate = this.#setImmediate.bind(this);
          (nodeTimers as MockableTimers).clearImmediate = this.#clearImmediate;
          (nodeTimersPromises as Pick<MockableTimers, "setImmediate">).setImmediate =
            this.#setImmediatePromisified.bind(this);
        },
        "Date": () => {
          this.#nativeDateDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Date");
          (globalThis as { Date: unknown }).Date = this.#createDate();
        },
        "AbortSignal.timeout": () => {
          this.#storeOriginalAbortSignalTimeout();
          const mock = this;
          Object.defineProperty(AbortSignal, "timeout", {
            // @ts-ignore
            __proto__: null,
            configurable: true,
            writable: true,
            value: function value(delay) {
              validateUint32(delay, "delay", false);
              const controller = new AbortController();
              // Don't keep an unused binding to the timer; mock tick controls it
              mock.#setTimeout(() => {
                controller.abort();
              }, delay);
              return controller.signal;
            },
          });
        },
      },
      toReal: {
        "__proto__": null,
        "scheduler.wait": () => {
          this.#restoreOriginalSchedulerWait();
        },
        "setTimeout": () => {
          this.#restoreOriginalSetTimeout();
        },
        "setInterval": () => {
          this.#restoreOriginalSetInterval();
        },
        "setImmediate": () => {
          this.#restoreSetImmediate();
        },
        "Date": () => {
          Object.defineProperty(globalThis, "Date", this.#nativeDateDescriptor);
        },
        "AbortSignal.timeout": () => {
          this.#restoreOriginalAbortSignalTimeout();
        },
      },
    };

    const target: Record<string, (() => void) | null> = activate ? options.toFake : options.toReal;
    for (const timer of this.#timersInContext) {
      target[timer]!();
    }
    this.#isEnabled = activate;
  }

  /**
   * Advances the virtual time of MockTimers by the specified duration (in milliseconds).
   * This method simulates the passage of time and triggers any scheduled timers that are due.
   */
  tick(time = 1) {
    this.#assertTimersAreEnabled();
    this.#assertTimeArg(time);

    this.#now += time;
    let timer = this.#executionQueue.peek();
    while (timer) {
      if (timer.runAt > this.#now) break;
      timer.callback.$apply(undefined, timer.args);

      // Check if the timeout was cleared by calling clearTimeout inside its own callback
      const afterCallback = this.#executionQueue.peek();
      if (afterCallback?.id === timer.id) {
        this.#executionQueue.shift();
        timer.priorityQueuePosition = undefined;
      }

      const { interval } = timer;
      if (interval !== undefined) {
        timer.runAt += interval;
        this.#executionQueue.insert(timer);
      }

      timer = this.#executionQueue.peek();
    }
  }

  /**
   * Enables the MockTimers replacing the native timers with the fake ones.
   */
  enable(
    options: { __proto__?: null; apis?: string[]; now?: number | Date } = {
      __proto__: null,
      apis: SUPPORTED_APIS,
      now: 0,
    },
  ) {
    const internalOptions = { __proto__: null, ...options } as { apis?: string[]; now?: number | Date };
    if (this.#isEnabled) {
      throw $ERR_INVALID_STATE("MockTimers is already enabled!");
    }

    const { now } = internalOptions;
    if (Number.isNaN(now)) {
      throw $ERR_INVALID_ARG_VALUE("now", now, `epoch must be a positive integer received ${now}`);
    }

    internalOptions.now ||= 0;

    internalOptions.apis ||= SUPPORTED_APIS;

    // Check that the timers passed are supported
    validateStringArray(internalOptions.apis, "options.apis");
    for (const timer of internalOptions.apis) {
      if (!SUPPORTED_APIS.includes(timer)) {
        throw $ERR_INVALID_ARG_VALUE("options.apis", timer, `option ${timer} is not supported`);
      }
    }
    this.#timersInContext = internalOptions.apis;

    // Checks if the second argument is the initial time
    const initialTime = internalOptions.now;
    if (this.#isValidDateWithGetTime(initialTime)) {
      this.#now = DatePrototypeGetTime.$call(initialTime);
    } else if (validateNumber(initialTime, "initialTime") === undefined) {
      this.#assertTimeArg(initialTime as number);
      this.#now = initialTime as number;
    }

    this.#toggleEnableTimers(true);
  }

  /**
   * Sets the current time to the given epoch.
   */
  setTime(time = kInitialEpoch) {
    validateNumber(time, "time");
    this.#assertTimeArg(time);
    this.#assertTimersAreEnabled();

    this.#now = time;
  }

  /**
   * An alias for `this.reset()`, allowing the disposal of the `MockTimers` instance.
   */
  [Symbol.dispose]() {
    this.reset();
  }

  /**
   * Resets MockTimers, disabling any enabled timers and clearing the execution queue.
   * Does nothing if MockTimers are not enabled.
   */
  reset() {
    // Ignore if not enabled
    if (!this.#isEnabled) return;

    this.#toggleEnableTimers(false);
    this.#timersInContext = [];
    this.#now = kInitialEpoch;

    let timer = this.#executionQueue.peek();
    while (timer) {
      this.#executionQueue.shift();
      timer = this.#executionQueue.peek();
    }
  }

  /**
   * Runs all scheduled timers until there are no more pending timers.
   */
  runAll() {
    this.#assertTimersAreEnabled();
    const longestTimer = this.#executionQueue.peekBottom();
    if (!longestTimer) return;
    this.tick(longestTimer.runAt - this.#now);
  }
}

export default { MockTimers };
