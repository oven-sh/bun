import { setDefaultTimeout } from "bun:test";
import { isASAN, isDebug } from "harness";

/** What scripts/runner.node.ts gives a case of a Bun with assertions (--timeout). A test file cannot read the flag. */
export const givenToABunWithAssertions = 270_000;

export const atLeastWhatTheRunnerGave = (milliseconds: number, hasAssertions: boolean) =>
  hasAssertions ? Math.max(milliseconds, givenToABunWithAssertions) : milliseconds;

/** For files whose cases need more than the five seconds of bun:test. It never lowers what the runner gave. */
export const raiseDefaultTimeout = (milliseconds: number) =>
  setDefaultTimeout(atLeastWhatTheRunnerGave(milliseconds, isASAN || isDebug));
