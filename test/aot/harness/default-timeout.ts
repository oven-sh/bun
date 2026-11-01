import {
  afterAll as afterAllOfBun,
  afterEach as afterEachOfBun,
  beforeAll as beforeAllOfBun,
  beforeEach as beforeEachOfBun,
  setDefaultTimeout,
  test as testOfBun,
} from "bun:test";
import { isASAN, isDebug } from "harness";
import { basename } from "node:path";
import { unlessLeftOut } from "./left-out";

/**
 * The least that scripts/runner.node.ts gives a case of a Bun with assertions (--timeout): a file that runs beside two others gets three times that.
 * A test file cannot read the flag. So under the runner no number is handed on that the flag covers, and what the runner gave holds.
 */
export const givenToABunWithAssertions = 270_000;

/** The runner sets the variable for every process that it starts, and gives that much to an executable of such a name: to another Bun with assertions it gives less. */
export const isGivenThatMuchByTheRunner = (variable: string | undefined, executable: string) =>
  variable !== undefined && basename(executable).includes("asan");

const isStartedByTheRunner = isGivenThatMuchByTheRunner(process.env.TEST_TMPDIR, process.execPath);

/** Undefined: no limit is handed on, so that the flag of the runner holds. */
export const atLeastWhatTheRunnerGave = (
  milliseconds: number,
  hasAssertions: boolean,
  byRunner = isStartedByTheRunner,
) => {
  if (!hasAssertions || milliseconds > givenToABunWithAssertions) return milliseconds;
  return byRunner ? undefined : givenToABunWithAssertions;
};

/**
 * What registers a case or a hook, and whatever is chained to it: a limit that is handed over as a number is raised as the default is, or left out.
 * The first operand is a title, a table, a condition or the hook itself, never a limit.
 */
export function raisingLimits<T extends object>(
  registers: T,
  hasAssertions: boolean,
  owner?: object,
  byRunner = isStartedByTheRunner,
): T {
  if (!hasAssertions) return registers;
  return new Proxy(registers, {
    apply(target, _, operands) {
      const raised = operands.filter((operand, index) => {
        if (index === 0 || typeof operand !== "number") return true;
        return atLeastWhatTheRunnerGave(operand, true, byRunner) !== undefined;
      });
      const limits = raised.map((operand, index) =>
        index > 0 && typeof operand === "number" ? atLeastWhatTheRunnerGave(operand, true, byRunner) : operand,
      );
      const result = Reflect.apply(target as Function, owner, limits);
      return typeof result === "function" ? raisingLimits(result, true, undefined, byRunner) : result;
    },
    get(target, name) {
      const value = Reflect.get(target, name, target);
      return typeof value === "function" ? raisingLimits(value, true, target, byRunner) : value;
    },
  });
}

/** For ../supported.ts, which reads from them once for all the files of a process and asks by itself whether a file is left out. */
export const whereverTheFileRuns = {
  test: raisingLimits(testOfBun, isASAN || isDebug),
  beforeAll: raisingLimits(beforeAllOfBun, isASAN || isDebug),
};
export const test = unlessLeftOut(whereverTheFileRuns.test);
export const it = test;
export const beforeAll = unlessLeftOut(whereverTheFileRuns.beforeAll);
export const afterAll = unlessLeftOut(raisingLimits(afterAllOfBun, isASAN || isDebug));
export const beforeEach = unlessLeftOut(raisingLimits(beforeEachOfBun, isASAN || isDebug));
export const afterEach = unlessLeftOut(raisingLimits(afterEachOfBun, isASAN || isDebug));

/** A limit that is itself what the case tests: what it waits for must have ended by then, on every lane. */
export const noLongerThan = (milliseconds: number) => ({ timeout: milliseconds });

/** For files whose cases need more than the five seconds of bun:test. It never lowers what the runner gave. */
export const raiseDefaultTimeout = (
  milliseconds: number,
  hasAssertions = isASAN || isDebug,
  byRunner = isStartedByTheRunner,
) => {
  const limit = atLeastWhatTheRunnerGave(milliseconds, hasAssertions, byRunner);
  if (limit !== undefined) setDefaultTimeout(limit);
};
