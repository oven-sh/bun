import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";

/** A Bun built with assertions or a sanitizer verifies every build, as `--aot-check=Validate` does. */
export const alwaysVerifies = isASAN || isDebug;

/**
 * Checks a build that injects a fault with `--aot-testing=` and does not pass `--aot-check`.
 * A release Bun accepts such a build. A Bun that always verifies rejects it with `diagnostic`.
 * Returns whether there is an executable to run.
 */
export function expectFaultyBuild(build: { stderr: string; exitCode: number | null }, diagnostic: string) {
  if (alwaysVerifies) {
    expect(build.stderr).toContain(diagnostic);
    expect(build.exitCode).toBe(1);
    return false;
  }
  expect(build.exitCode).toBe(0);
  return true;
}
