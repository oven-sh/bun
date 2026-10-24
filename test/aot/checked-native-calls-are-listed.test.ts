import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isHardened } from "./hardened";
import { run as runProcess } from "./harness/run";
import { withoutCoreDump } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

// An executable built with --aot-validate compares what each native function does with what the table of built-ins says of it. An entry of the table
// is checked only as far as the calls go that a test makes: a call that the function refuses shows nothing of what it writes. So where
// BUN_AOT_CHECKED_NATIVE_CALLS names a file, the executable appends a line for each entry that its checks met: the entry, and how many of its calls
// returned, threw, changed an operand, and came with what the compiler believed about the call. A hardened build has no code for it.
const program = `const bytes = new Uint8Array(8);
crypto.getRandomValues(bytes);
console.log(structuredClone({ a: 1 }).a, btoa("ab"));
for (const text of ["YWI=", "*", "**"]) {
  try {
    console.log(atob(text));
  } catch (error) {
    console.log((error as Error).name);
  }
}
if (process.argv[2] === "collect") Bun.gc(true);
`;

describe.skipIf(isHardened)("the native calls that a validating executable checked", () => {
  const dir = tempDir("checked-native-calls", { "main.ts": program });
  const executable = join(String(dir), "program");
  const list = join(String(dir), "checked.txt");
  const rows = () =>
    Object.fromEntries(
      readFileSync(list, "utf8")
        .split("\n")
        .filter(line => line !== "")
        .map(line => [line.split("\t")[0].split("/")[0], line.split("\t").slice(1).map(Number)]),
    );

  beforeAll(async () => {
    const built = await runProcess(
      [bunExe(), "build", "--compile", "--aot", "--aot-validate", "main.ts", "--outfile", executable],
      String(dir),
      bunEnv,
    );
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
  });

  afterAll(() => dir[Symbol.dispose]());

  test("each entry has a line with its four counts", async () => {
    const { stdout, stderr, exitCode } = await runProcess([executable], String(dir), {
      ...bunEnv,
      BUN_AOT_CHECKED_NATIVE_CALLS: list,
    });
    expect({ stdout, stderr, exitCode }).toEqual({
      stdout: "1 YWI=\nab\nInvalidCharacterError\nInvalidCharacterError\n",
      stderr: "",
      exitCode: 0,
    });
    expect(readFileSync(list, "utf8")).toMatch(/^([^\t\n]+(\t[0-9]+){4}\n)+$/);
    expect(rows()).toMatchObject({
      Atob: [1, 2, 0, 3],
      Btoa: [1, 0, 0, 1],
      CryptoPrototypeGetRandomValues: [1, 0, 1, 1],
      StructuredClone: [1, 0, 0, 1],
    });
  });

  test("a second run appends", async () => {
    const before = readFileSync(list, "utf8");
    await runProcess([executable], String(dir), { ...bunEnv, BUN_AOT_CHECKED_NATIVE_CALLS: list });
    expect(readFileSync(list, "utf8")).toBe(before + before);
  });

  test("a run that a failed validation ends has written its lines", async () => {
    const listOfCrash = join(String(dir), "checked-before-the-crash.txt");
    const { stderr, exitCode } = await runProcess(withoutCoreDump([executable, "collect"]), String(dir), {
      ...bunEnv,
      BUN_AOT_CHECKED_NATIVE_CALLS: listOfCrash,
      BUN_CRASH_REPORT_URL: "",
      BUN_ENABLE_CRASH_REPORTING: "0",
      // As in fast-visit-validation.test.ts: the collector's comparison of its two visits is made to fail.
      BUN_JSC_numberOfGCMarkers: "1",
      BUN_JSC_useConcurrentGC: "0",
      BUN_JSC_dropLastFastVisitReferenceForTesting: "1",
    });
    expect(stderr).toContain("AOT validation: VisitedCellsDiffer ");
    expect(exitCode).not.toBe(0);
    expect(readFileSync(listOfCrash, "utf8")).toContain("Atob/0\t1\t2\t0\t3\n");
  });

  test("nothing is written where no file is named", async () => {
    const before = readFileSync(list, "utf8");
    const { exitCode } = await runProcess([executable], String(dir), bunEnv);
    expect(exitCode).toBe(0);
    expect(readFileSync(list, "utf8")).toBe(before);
  });
});
