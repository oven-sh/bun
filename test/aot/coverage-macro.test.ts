// `bun test --aot` refuses a file that imports a macro, with --coverage as without it: docs/compiler/compatibility.mdx, "Not supported". No test runs and no report is written.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "macro.ts": `
export const make = () => ({ a: { b: 1 }, c: [{}], text: "two\\nlines" });
export const yes = () => true;
export const twice = (n: number) => n * 2;
`,
  "lib.ts": `// 1
import { make, yes, twice } from "./macro.ts" with { type: "macro" };
export const made = make();
export function chosen() {
  if (yes()) {
    return twice(
      2,
    );
  } else {
    return 0;
  }
}
export function unused() {
  return made;
}
`,
  "lib.test.ts": `
import { test } from "bun:test";
import { chosen } from "./lib.ts";
test("lib", () => { console.log("ANSWER", chosen()); });
`,
};

async function report(flags: string[]) {
  using directory = tempDir("aot-coverage-macro", files);
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "test", ...flags, "--coverage", "--coverage-reporter=lcov"],
    String(directory),
    bunEnv,
  );
  const path = join(String(directory), "coverage", "lcov.info");
  const reported = existsSync(path)
    ? [...readFileSync(path, "utf8").matchAll(/SF:(.*)/g)].map(match => match[1])
    : null;
  const errors = [...new Set(stderr.split("\n").filter(line => line.startsWith("error: TS")))];
  return { answer: /ANSWER.*/.exec(stdout)?.[0], errors, exitCode, reported };
}

test("coverage of a file that imports a macro: the run is refused", async () => {
  const [plain, compiled] = await Promise.all([report([]), report(["--aot"])]);
  expect(plain).toEqual({ answer: "ANSWER 4", errors: [], exitCode: 0, reported: ["lib.ts"] });
  expect(compiled).toEqual({
    answer: undefined,
    errors: [expect.stringMatching(/^error: TS100053: Macros are disabled/)],
    exitCode: 1,
    reported: null,
  });
});
