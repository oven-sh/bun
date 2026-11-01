// `bun test --aot --coverage` reports on a file that imports a macro as `bun test --coverage` does: its lines are listed by what the macro gave the build, no macro runs
// again at the end of the run, and the macro's own file is not in the report.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

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

async function report(flags: string[], env: Record<string, string>) {
  using directory = tempDir("aot-coverage-macro", files);
  const { stdout, exitCode } = await run(
    [bunExe(), "test", ...flags, "--coverage", "--coverage-reporter=lcov"],
    String(directory),
    { ...bunEnv, ...env },
  );
  const lcov = readFileSync(join(String(directory), "coverage", "lcov.info"), "utf8");
  const records = lcov
    .split("end_of_record")
    .filter(record => record.includes("SF:"))
    .map(record => [/SF:(.*)/.exec(record)![1], ...(record.match(/^DA:.*$/gm) ?? [])].join(" "));
  return { answer: /ANSWER.*/.exec(stdout)?.[0], exitCode, records };
}

describe.concurrent("coverage of a file that imports a macro", () => {
  test.each([
    ["one program", {}],
    ["two layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" }],
  ] as [string, Record<string, string>][])("%s", async (_, env) => {
    const [plain, compiled] = await Promise.all([report([], {}), report(["--aot"], env)]);
    expect(plain.records.map(record => record.split(" ")[0])).toEqual(["lib.ts"]);
    expect(compiled).toEqual(plain);
  });
});
