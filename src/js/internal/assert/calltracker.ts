"use strict";

const { SafeSet, SafeWeakMap } = require("internal/primordials");

const AssertionError = require("internal/assert/assertion_error");
const { validateUint32 } = require("internal/validators");

const ObjectFreeze = Object.freeze;
const ArrayPrototypePush = Array.prototype.push;
const ArrayPrototypeSlice = Array.prototype.slice;

const noop = () => {};

class CallTrackerContext {
  #expected;
  #calls;
  #name;
  #stackTrace;
  constructor({ expected, stackTrace, name }) {
    this.#calls = [];
    this.#expected = expected;
    this.#stackTrace = stackTrace;
    this.#name = name;
  }

  track(thisArg, args) {
    const argsClone = ObjectFreeze(ArrayPrototypeSlice.$call(args));
    ArrayPrototypePush.$call(this.#calls, ObjectFreeze({ thisArg, arguments: argsClone }));
  }

  get delta() {
    return this.#calls.length - this.#expected;
  }

  reset() {
    this.#calls = [];
  }
  getCalls() {
    return ObjectFreeze(ArrayPrototypeSlice.$call(this.#calls));
  }

  report() {
    if (this.delta !== 0) {
      const message =
        `Expected the ${this.#name} function to be ` +
        `executed ${this.#expected} time(s) but was ` +
        `executed ${this.#calls.length} time(s).`;
      return {
        message,
        actual: this.#calls.length,
        expected: this.#expected,
        operator: this.#name,
        stack: this.#stackTrace,
      };
    }
  }
}

class CallTracker {
  #callChecks = new SafeSet();
  #trackedFunctions = new SafeWeakMap();

  #getTrackedFunction(tracked) {
    if (!this.#trackedFunctions.has(tracked)) {
      throw $ERR_INVALID_ARG_VALUE("tracked", tracked, "is not a tracked function");
    }
    return this.#trackedFunctions.get(tracked);
  }

  reset(tracked) {
    if (tracked === undefined) {
      this.#callChecks.forEach(check => check.reset());
      return;
    }

    this.#getTrackedFunction(tracked).reset();
  }

  getCalls(tracked) {
    return this.#getTrackedFunction(tracked).getCalls();
  }

  calls(fn, expected = 1) {
    if (process._exiting) throw $ERR_UNAVAILABLE_DURING_EXIT();
    if (typeof fn === "number") {
      expected = fn;
      fn = noop;
    } else if (fn === undefined) {
      fn = noop;
    }

    validateUint32(expected, "expected", true);

    const context = new CallTrackerContext({
      expected,
      // eslint-disable-next-line no-restricted-syntax
      stackTrace: new Error(),
      name: fn.name || "calls",
    });
    const tracked = new Proxy(fn, {
      __proto__: null,
      apply(fn, thisArg, argList) {
        context.track(thisArg, argList);
        return fn.$apply(thisArg, argList);
      },
    });
    this.#callChecks.add(context);
    this.#trackedFunctions.set(tracked, context);
    return tracked;
  }

  report() {
    const errors: Error[] = [];
    for (const context of this.#callChecks) {
      const message = context.report();
      if (message !== undefined) {
        ArrayPrototypePush.$call(errors, message);
      }
    }
    return errors;
  }

  verify() {
    const errors = this.report();
    if (errors.length === 0) {
      return;
    }
    const message = errors.length === 1 ? errors[0].message : "Functions were not called the expected number of times";
    throw new AssertionError({
      message,
      details: errors,
    });
  }
}

export default CallTracker;
