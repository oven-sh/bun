// For everyday-failing-tests-*.test.ts. Each case of everyday-failing-test-cases.ts is laid out as a project of its own and run by `bun test` and by `bun test --aot`, each run in a folder and a process of its
// own. A test that fails has to be told of as one that fails: the exit code and the lines of the tests are those of `bun test`.
import { expect } from "bun:test";
import { everydayFailingTests } from "./everyday-failing-test-cases";
import { each } from "./everyday-mocks-of-several-steps";

// These tests wait for timers, so a case is asked up to three times, and fails if it fails each time.
export function everydayFailingTestsIn(part: number, parts: number) {
  each(
    everydayFailingTests(),
    part,
    parts,
    (name, plain, compiled) => {
      // A pair is a pair: the good one passes and the bad one fails.
      expect(plain.exitCode === 0).toBe(name.endsWith("--good"));
      expect({ ...compiled, didNotRunAgain: 0 }).toEqual(plain);
    },
    3,
  );
}
