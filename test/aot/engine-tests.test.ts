// Runs the engine's own tests in Bun's CI: the IR text tests and the native tests that were packed with the WebKit this
// Bun was linked against. `testaot all` runs them in one go, which takes longer than one test may: here the IR text tests
// are one test and the native tests four, each a part of the list, at the same time.
//
// Needs `testaot`, the `aot-tests` folder for two of the tests, and `jsc` for two: the engine's own tests want it in the
// folder of `testaot`. shell/tools.ts says where each is looked for. A test whose tool is missing is skipped, and stderr
// says which tool.
//   $TESTAOT run <aot/tests>/passes/sink-allocations --jobs=1     one folder, serially, each path printed before it runs
//   $TESTAOT native <filter> --part=2/4                           every fourth of the native tests whose name holds the filter, from the second on
import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { engineTests, jsc, testaot, toolEnv } from "./shell/tools";

const program = join(engineTests ?? "", "driver", "check-next.ir");
const shellPath = testaot && join(dirname(testaot), "jsc" + (isWindows ? ".exe" : ""));

const whySkipped = !testaot
  ? "there is no testaot: not in $TESTAOT, not beside the Bun under test, not in build/release-local or build/release"
  : undefined;
const whyEngineTestsSkipped =
  whySkipped ??
  (!engineTests
    ? "two tests need the engine's test files: not in $AOT_ENGINE_TESTS, no aot-tests beside the Bun under test, no aot/tests in $BUN_WEBKIT_PATH or vendor/WebKit"
    : undefined);
const whyNativeTestsSkipped =
  whyEngineTestsSkipped ??
  (!existsSync(shellPath!)
    ? `one test needs jsc in the folder of testaot, where the engine's native tests start it: there is no ${shellPath}`
    : undefined);
const whyShellSkipped =
  whySkipped ??
  (!jsc
    ? "one test needs jsc: not in $JSC, not beside the Bun under test, not in build/release-local or build/release"
    : undefined);
for (const why of new Set([whySkipped, whyEngineTestsSkipped, whyNativeTestsSkipped, whyShellSkipped])) {
  if (why) console.error(`SKIPPED: test/aot/engine-tests.test.ts: ${why}`);
}

async function runTool(cmd: string[]) {
  await using tool = Bun.spawn({ cmd, env: toolEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([tool.stdout.text(), tool.stderr.text(), tool.exited]);
  return { lines: stdout.split(/\r?\n/).filter(line => line !== ""), stderr, exitCode };
}

const run = (...args: string[]) => runTool([testaot!, ...args]);

function expectEveryTestPassed({ lines, stderr, exitCode }: Awaited<ReturnType<typeof run>>) {
  expect(lines.filter(line => line.startsWith("FAIL "))).toEqual([]);
  // After a crash, lastLine names the native test and stderr has the failed check: stderr is listed so that it is printed.
  expect({ lastLine: lines.at(-1), stderr, exitCode }).toEqual({
    lastLine: expect.stringMatching(/^[1-9][0-9]* passed, 0 failed, [0-9]+ todo$/),
    stderr: expect.any(String),
    exitCode: 0,
  });
}

(whyEngineTestsSkipped ? test.skip : test.concurrent)(
  "the engine's IR text tests pass",
  async () => {
    expectEveryTestPassed(await run("run", engineTests!));
  },
  290_000,
);

const parts = 4;
(whyNativeTestsSkipped ? test.skip : test.concurrent).each(Array.from({ length: parts }, (_, index) => index + 1))(
  `the engine's native tests pass: part %d of ${parts}`,
  async part => {
    expectEveryTestPassed(await run("native", `--part=${part}/${parts}`));
  },
  290_000,
);

test.skipIf(!!whyEngineTestsSkipped).each([
  ["an unknown list", ["list", "nothing"], 2],
  ["an unknown option", ["run", "--no-such-option=1", "x.ir"], 2],
  ["an unknown subcommand", ["nothing"], 2],
  ["print without a program", ["print"], 2],
  ["an unknown pass", ["print", program, "--until=NoSuchPass"], 2],
  ["an unknown option word", ["print", program, "no-such-word"], 2],
  ["compile without --output", ["compile", program], 2],
  ["a filter that matches no native test", ["native", "no-such-test"], 1],
  ["a part that is not among the parts", ["native", "--part=3/2"], 2],
])("testaot rejects %s", async (_, args, expectedExitCode) => {
  const { stderr, exitCode } = await run(...args);
  expect({ stderr, exitCode }).toEqual({ stderr: expect.stringMatching(/./), exitCode: expectedExitCode });
});

test.skipIf(!!whySkipped)("testaot fails a test file that does not exist", async () => {
  const { lines, exitCode } = await run("run", "no-such-file.ir");
  expect(lines).toEqual([expect.stringMatching(/^FAIL no-such-file\.ir:1: /), "0 passed, 1 failed, 0 todo"]);
  expect(exitCode).toBe(1);
});

test.skipIf(!!whyShellSkipped)("jsc rejects a file that is not an image", async () => {
  using folder = tempDir("aot-engine-tests", { "nothing.image": "" });
  const image = join(String(folder), "nothing.image");
  const { stderr, exitCode } = await runTool([jsc!, `--aotImagePath=${image}`, "-e", "0"]);
  expect(stderr).toContain("Cannot use ");
  expect(exitCode).toBe(1);
});
