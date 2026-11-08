import { expect } from "bun:test";
import { filesThatFailFirst } from "./everyday-mock-cases-that-fail-first";
import { each } from "./everyday-mocks-of-several-steps";

const partsWhereFileFailsFirst: [cases: RegExp, what: string][] = [
  [
    /^(an-es-file|a-commonjs-file|a-commonjs-package)--(imported-at-run-time|imported-by-a-file)--a-factory-over-(the-original|import-actual)--mocked-the-second-time--modules-reset--/,
    "a mock that needs the original, behind resetModules(): the load throws an EvalError",
  ],
  [
    /^an-es-file--(imported-at-run-time|required)--a-factory-over-(the-original|import-actual)--mocked-the-second-time--nothing-between--/,
    "the kiln does not run again for the mock that needs it: the first failure is answered",
  ],
  [
    /^an-es-file--required--mock-module--mocked-the-second-time--nothing-between--/,
    "require() answers the first failure of the kiln, not the mock",
  ],
  [
    /^an-es-file--imported-by-a-file--a-factory-over-import-actual--mocked-the-second-time--nothing-between--/,
    "the potter keeps the first failure of the kiln, and the factory fails the test",
  ],
  [
    /^an-es-file--imported-by-a-file--(a-factory-over-the-original|a-factory)--mocked-the-second-time--nothing-between--in-the-next-test-file$/,
    "the potter keeps the first failure of the kiln for the next test file",
  ],
  [
    /^an-es-file--required--a-factory-over-import-actual--mocked-both-times--(nothing-between|unmocked)--/,
    "the kiln failed under the first mock and does not run again for the second",
  ],
  [
    /^an-es-file--required--a-factory-over-the-original--mocked-both-times--(nothing-between|unmocked)--in-the-next-test-file$/,
    "the same, for the next test file",
  ],
  [
    /^an-es-package--imported-by-a-file--a-factory-over-(the-original|import-actual)--mocked-the-second-time--nothing-between--/,
    "the factory is called, and runs the body of the kiln a second time, where the potter still gets the first failure",
  ],
  [
    /^an-es-package--imported-by-a-file--a-factory--mocked-the-second-time--nothing-between--in-the-next-test-file$/,
    "the potter keeps the first failure of the kiln for the next test file",
  ],
  [
    /^an-es-package--imported-at-run-time--mock-module--mocked-the-second-time--nothing-between--/,
    "import() gets the mock where `bun test` keeps the first failure",
  ],
];

export function mocksOverFileThatFailsFirstIn(part: number, parts: number) {
  each(filesThatFailFirst(), part, parts, (name, plain, compiled) => {
    const [, what] = partsWhereFileFailsFirst.find(([names]) => names.test(name)) ?? [];
    if (what !== undefined)
      expect(
        { ...compiled, didNotRunAgain: 0 },
        `GOOD NEWS: the two runs agree now. Take this case out of partsWhereFileFailsFirst in test/aot/harness/everyday-mocks-that-fail-first.ts, with the change that mended it. Its line: "${what}"`,
      ).not.toEqual(plain);
    else expect({ ...compiled, didNotRunAgain: 0 }).toEqual(plain);
  });
}
