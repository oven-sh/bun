import { expect } from "bun:test";
import { failingModuleCases } from "./failing-module-mock-cases";
import { each } from "./everyday-mocks-of-several-steps";

const knownDifferences: [cases: RegExp, what: string][] = [
  [
    /^an-es-file--required--a-factory-over-(the-original|import-actual)--mocked-the-second-time--nothing-between--/,
    "the kiln does not run again for the mock that needs it: the first failure is answered",
  ],
  [
    /^an-es-file--imported-by-a-file--a-factory-over-import-actual--mocked-the-second-time--nothing-between--in-the-next-test-file$/,
    "the potter keeps the first failure of the kiln, and the factory fails the test",
  ],
  [
    /^an-es-file--imported-by-a-file--a-factory-over-the-original--mocked-the-second-time--nothing-between--in-the-next-test-file$/,
    "the potter keeps the first failure of the kiln for the next test file",
  ],
];

export function testFailingModuleMocks(part: number, parts: number) {
  each(failingModuleCases(), part, parts, (name, plain, compiled) => {
    const [, what] = knownDifferences.find(([names]) => names.test(name)) ?? [];
    if (what !== undefined)
      expect(
        { ...compiled, didNotRunAgain: 0 },
        `GOOD NEWS: the two runs agree now. Take this case out of knownDifferences in test/aot/harness/failing-module-mocks.ts, with the change that fixed it. Its line: "${what}"`,
      ).not.toEqual(plain);
    else expect({ ...compiled, didNotRunAgain: 0 }).toEqual(plain);
  });
}
