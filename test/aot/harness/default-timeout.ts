import {
  afterAll as afterAllOfBun,
  afterEach as afterEachOfBun,
  beforeAll as beforeAllOfBun,
  beforeEach as beforeEachOfBun,
  setDefaultTimeout,
  test as testOfBun,
} from "bun:test";
import { isASAN, isDebug } from "harness";

/** What scripts/runner.node.ts gives a case of a Bun with assertions (--timeout). A test file cannot read the flag. */
export const givenToABunWithAssertions = 270_000;

export const atLeastWhatTheRunnerGave = (milliseconds: number, hasAssertions: boolean) =>
  hasAssertions ? Math.max(milliseconds, givenToABunWithAssertions) : milliseconds;

/**
 * What registers a case or a hook, and whatever is chained to it: a limit that is handed over as a number is raised as the default is.
 * The first operand is a title, a table, a condition or the hook itself, never a limit.
 */
export function raisingLimits<T extends object>(registers: T, hasAssertions: boolean, owner?: object): T {
  if (!hasAssertions) return registers;
  return new Proxy(registers, {
    apply(target, _, operands) {
      const raised = operands.map((operand, index) =>
        index > 0 && typeof operand === "number" ? atLeastWhatTheRunnerGave(operand, true) : operand,
      );
      const result = Reflect.apply(target as Function, owner, raised);
      return typeof result === "function" ? raisingLimits(result, true) : result;
    },
    get(target, name) {
      const value = Reflect.get(target, name, target);
      return typeof value === "function" ? raisingLimits(value, true, target) : value;
    },
  });
}

export const test = raisingLimits(testOfBun, isASAN || isDebug);
export const it = test;
export const beforeAll = raisingLimits(beforeAllOfBun, isASAN || isDebug);
export const afterAll = raisingLimits(afterAllOfBun, isASAN || isDebug);
export const beforeEach = raisingLimits(beforeEachOfBun, isASAN || isDebug);
export const afterEach = raisingLimits(afterEachOfBun, isASAN || isDebug);

/** A limit that is itself what the case tests: what it waits for must have ended by then, on every lane. */
export const noLongerThan = (milliseconds: number) => ({ timeout: milliseconds });

/** For files whose cases need more than the five seconds of bun:test. It never lowers what the runner gave. */
export const raiseDefaultTimeout = (milliseconds: number) =>
  setDefaultTimeout(atLeastWhatTheRunnerGave(milliseconds, isASAN || isDebug));
