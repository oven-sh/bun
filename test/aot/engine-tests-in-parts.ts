// The engine's own tests where `testaot` was built with a sanitizer and with assertions: it takes several times as long as ./engine-tests.test.ts has for them,
// so here they come in parts, each a test file of its own (parts.mts). A part is every n-th IR text test and every n-th native test. Any other build of Bun skips these,
// and a build with a sanitizer skips them there.
//
//   TEST_PART=aot/engine-tests-in-parts-3 bun test test/aot/parts.test.ts
import { expect, test } from "bun:test";
import { existsSync, readdirSync } from "fs";
import { isASAN, isDebug, isWindows } from "harness";
import { dirname, join } from "path";
import { run } from "./harness/run";
import { engineTests, testaot, toolEnv } from "./shell/tools";

/** Whether the engine's tests come in parts with this Bun. */
export const comeInParts = isASAN || isDebug;

async function expectEveryTestPasses(...args: string[]) {
  const { stdout, stderr, exitCode } = await run([testaot!, ...args], undefined, toolEnv);
  const lines = stdout.split(/\r?\n/).filter(line => line !== "");
  // In front of its FAIL line a native test that crashed has said which check failed, and where.
  const hasFailed = lines.some(line => line.startsWith("FAIL "));
  expect(hasFailed ? lines.filter(line => !/^(PASS|TODO|SKIP|  still fails:) /.test(line)).slice(-60) : []).toEqual([]);
  expect({ lastLine: lines.at(-1), stderr, exitCode }).toEqual({
    lastLine: expect.stringMatching(/^[1-9][0-9]* passed, 0 failed, [0-9]+ todo$/),
    stderr: expect.any(String),
    exitCode: 0,
  });
}

export function engineTestsInParts(part: number, parts: number) {
  const why = !comeInParts
    ? "test/aot/engine-tests.test.ts runs them in one go"
    : !testaot || !engineTests
      ? "there is no testaot or no aot-tests: test/aot/engine-tests.test.ts says where they are looked for, and fails in CI where one is missing"
      : !existsSync(join(dirname(testaot), "jsc" + (isWindows ? ".exe" : "")))
        ? "the engine's native tests start jsc in the folder of testaot, and there is none"
        : undefined;
  if (why) return void test.skip(why, () => {});

  const mine = [engineTests!, join(import.meta.dir, "engine-tests")]
    .flatMap(folder =>
      readdirSync(folder, { recursive: true, encoding: "utf8" })
        .filter(path => path.endsWith(".ir"))
        .sort()
        .map(path => join(folder, path)),
    )
    .filter((_, index) => index % parts === part - 1);
  test.concurrent(`IR text tests: part ${part} of ${parts}`, () => expectEveryTestPasses("run", ...mine), 560_000);
  test.concurrent(
    `native tests: part ${part} of ${parts}`,
    () => expectEveryTestPasses("native", `--part=${part}/${parts}`),
    560_000,
  );
}
