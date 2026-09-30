// vi.waitFor and vi.waitUntil, with Vitest's semantics: https://vitest.dev/api/vi.html#vi-waitfor
// Under fake timers each check advances the fake clock by `interval` and `timeout` counts fake
// time, as in @testing-library/dom's waitFor. setImmediate spaces those checks: fake timers leave it real.

const { validateFunction, validateNumber, validateObject } = require("internal/validators");

const isFakeTimers = $newRustFunction("FakeTimers.rs", "isFakeTimers", 0);
const advanceTimersByTime = $newRustFunction("FakeTimers.rs", "advanceTimersByTime", 1);

const realSetTimeout = setTimeout;
const realClearTimeout = clearTimeout;
const realSetImmediate = setImmediate;
const realClearImmediate = clearImmediate;
// Under fake timers, performance.now() reads the fake clock.
const performanceObject = performance;
const performanceNow = performance.now;
const ErrorConstructor = Error;

// Matches Node's internal/timers TIMEOUT_MAX.
const kTimeoutMax = 2 ** 31 - 1;
const kDefaultInterval = 50;
const kDefaultTimeout = 1000;
// advanceTimersByTime(0) advances the fake clock by 1 ms.
const kZeroIntervalAdvance = 1;

type WaitOptions = number | { timeout?: number; interval?: number } | undefined;

type WaitPolicy = {
  accepts: (value: unknown) => boolean;
  rejectsOnError: boolean;
  timeoutMessage: string;
};

const waitForPolicy: WaitPolicy = {
  accepts: () => true,
  rejectsOnError: false,
  timeoutMessage: "Timed out in waitFor!",
};

const waitUntilPolicy: WaitPolicy = {
  accepts: value => !!value,
  rejectsOnError: true,
  timeoutMessage: "Timed out in waitUntil!",
};

function parseOptions(options: WaitOptions) {
  if (typeof options === "number") {
    validateNumber(options, "timeout", 0, kTimeoutMax);
    return { timeout: options, interval: kDefaultInterval };
  }
  if (options === undefined) {
    return { timeout: kDefaultTimeout, interval: kDefaultInterval };
  }
  validateObject(options, "options");
  const { timeout = kDefaultTimeout, interval = kDefaultInterval } = options;
  validateNumber(timeout, "options.timeout", 0, kTimeoutMax);
  validateNumber(interval, "options.interval", 0, kTimeoutMax);
  return { timeout, interval };
}

function wait<T>(policy: WaitPolicy, callback: () => T | PromiseLike<T>, options: WaitOptions): Promise<T> {
  validateFunction(callback, "callback");
  const { timeout, interval } = parseOptions(options);
  const fakeAdvance = interval === 0 ? kZeroIntervalAdvance : interval;
  const timeoutError = new ErrorConstructor(policy.timeoutMessage);
  const promise = $newPromise<T>();

  let isSettled = false;
  let isPending = false;
  let hasLastError = false;
  let lastError: unknown;
  let tickTimer: Timer | undefined;
  let tickImmediate: Timer | undefined;
  let deadlineTimer: Timer | undefined;
  // Time the wait has used, in ms. Under fake timers each advance this wait makes counts as at least
  // `interval`, so the wait still ends when the callback restarts fake timers; a bigger jump, such
  // as the callback advancing the clock, counts in full. performance.now() follows the active clock.
  let elapsed = 0;
  let lastFakeReading: number | undefined;
  let lastRealReading: number | undefined;
  let uncountedAdvance = 0;

  const readClock = () => performanceNow.$call(performanceObject);

  const countFakeTime = () => {
    if (deadlineTimer !== undefined) {
      realClearTimeout(deadlineTimer);
      deadlineTimer = undefined;
    }
    lastRealReading = undefined;
    const now = readClock();
    if (lastFakeReading !== undefined) {
      const delta = now - lastFakeReading;
      elapsed += delta > uncountedAdvance ? delta : uncountedAdvance;
    }
    lastFakeReading = now;
    uncountedAdvance = 0;
    return elapsed;
  };

  const countRealTime = () => {
    elapsed += uncountedAdvance;
    uncountedAdvance = 0;
    lastFakeReading = undefined;
    const now = readClock();
    if (lastRealReading !== undefined && now > lastRealReading) elapsed += now - lastRealReading;
    lastRealReading = now;
    if (deadlineTimer === undefined) {
      deadlineTimer = realSetTimeout(onDeadline, elapsed < timeout ? timeout - elapsed : 0);
    }
  };

  const settle = () => {
    isSettled = true;
    if (tickTimer !== undefined) realClearTimeout(tickTimer);
    if (tickImmediate !== undefined) realClearImmediate(tickImmediate);
    if (deadlineTimer !== undefined) realClearTimeout(deadlineTimer);
  };

  const onValue = (value: unknown) => {
    if (isSettled || !policy.accepts(value)) return;
    settle();
    $resolvePromise(promise, value as T);
  };

  const onError = (error: unknown) => {
    if (isSettled) return;
    if (policy.rejectsOnError) {
      settle();
      $rejectPromise(promise, error);
    } else {
      hasLastError = true;
      lastError = error;
    }
  };

  const onTimeout = () => {
    settle();
    $rejectPromise(promise, hasLastError ? lastError : timeoutError);
  };

  // Once fake timers are on, the fake clock decides the timeout, even if this real deadline passed.
  const onDeadline = () => {
    deadlineTimer = undefined;
    if (!isFakeTimers()) onTimeout();
  };

  // A thenable settles its attempt once, like Promise resolution: later calls and throws are ignored.
  const attempt = () => {
    let isAttemptSettled = false;
    const fulfillAttempt = (value: unknown) => {
      if (isAttemptSettled) return;
      isAttemptSettled = true;
      isPending = false;
      onValue(value);
    };
    const rejectAttempt = (error: unknown) => {
      if (isAttemptSettled) return;
      isAttemptSettled = true;
      isPending = false;
      onError(error);
    };

    try {
      const result = callback();
      const isObject = result !== null && (typeof result === "object" || typeof result === "function");
      // Read `then` with one Get, as Promise resolution does, so a Proxy's has() trap is never consulted.
      const maybeThenable = result as PromiseLike<T>;
      const then: unknown = isObject ? maybeThenable.then : undefined;
      if (typeof then !== "function") {
        fulfillAttempt(result);
        return;
      }
      isPending = true;
      then.$call(result, fulfillAttempt, rejectAttempt);
    } catch (error) {
      rejectAttempt(error);
    }
  };

  const check = () => {
    if (isFakeTimers()) {
      countFakeTime();
      advanceTimersByTime(interval);
      uncountedAdvance = fakeAdvance;
    } else {
      countRealTime();
    }
    if (isSettled || isPending) return;
    attempt();
  };

  const tick = () => {
    tickTimer = undefined;
    tickImmediate = undefined;
    // Mirrors Vitest, whose timeout fires before a check that would come after it.
    if (isFakeTimers() && countFakeTime() + fakeAdvance > timeout) {
      onTimeout();
      return;
    }
    check();
    scheduleNextCheck();
  };

  const scheduleNextCheck = () => {
    if (isSettled) return;
    if (isFakeTimers()) {
      tickImmediate = realSetImmediate(tick);
      return;
    }
    countRealTime();
    tickTimer = realSetTimeout(tick, interval);
  };

  check();
  scheduleNextCheck();
  return promise;
}

function waitFor<T>(callback: () => T | PromiseLike<T>, options?: WaitOptions): Promise<T> {
  return wait(waitForPolicy, callback, options);
}

function waitUntil<T>(callback: () => T | PromiseLike<T>, options?: WaitOptions): Promise<T> {
  return wait(waitUntilPolicy, callback, options);
}

export default { waitFor, waitUntil };
