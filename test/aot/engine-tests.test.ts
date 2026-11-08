// `testaot`, the program that runs the engine's own tests, and `jsc` answer a wrong command line and a missing file as they should.
// The tests themselves: ./engine/.
//
// Needs `testaot`, the `aot-tests` folder for two of the tests, and `jsc` for two: the engine's own tests want it in the
// folder of `testaot`. shell/tools.ts says where each is looked for. A test whose tool is missing is skipped, and stderr
// says which tool.
//   $TESTAOT run <aot/tests>/walk/virtual-objects --jobs=1        one folder, serially, each path printed before it runs
//   $TESTAOT native <filter> --part=2/4                           every fourth of the native tests whose name holds the filter, from the second on
import { expect } from "bun:test";
import { isCI, isWindows, tempDir } from "harness";
import { join } from "path";
import {
  run,
  runTool,
  whyEngineTestsSkipped,
  whyNativeTestsSkipped,
  whyShellSkipped,
  whySkipped,
} from "./engine-test-commands";
import { test } from "./harness/default-timeout";
import { engineTests, jsc, scriptSkipReason } from "./shell/tools";

const program = join(engineTests ?? "", "driver", "check-next.ir");
for (const why of new Set([whySkipped, whyEngineTestsSkipped, whyNativeTestsSkipped, whyShellSkipped])) {
  if (why) console.error(`SKIPPED: test/aot/engine-tests.test.ts: ${why}`);
}

// Test files of this folder skip themselves where a tool is missing: collector-stress/, bad-time/, generated-code, and this
// one. CI packs the tools beside Bun; AOT_TOOLS=required says the same of any other place.
test.skipIf(isWindows || (!isCI && process.env.AOT_TOOLS !== "required"))("no tool is missing", () => {
  expect([whyNativeTestsSkipped, whyShellSkipped, scriptSkipReason].filter(why => why !== undefined)).toEqual([]);
});

test.skipIf(!!whyEngineTestsSkipped).each([
  ["an unknown list", ["list", "nothing"], 2],
  ["an unknown option", ["run", "--no-such-option=1", "x.ir"], 2],
  ["an unknown subcommand", ["nothing"], 2],
  ["print without a program", ["print"], 2],
  // A word without `=` that is no option word is an argument of the command.
  ["an unknown option word", ["print", program, "no-such-word=1"], 2],
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

test.skipIf(!!whyEngineTestsSkipped || !!whyShellSkipped)("jsc takes an image that testaot wrote", async () => {
  using folder = tempDir("aot-engine-tests", {});
  const image = join(String(folder), "program.image");
  const withEntryPoint = join(engineTests!, "answers", "whole-double-in-list.ir");
  expect(await run("compile", withEntryPoint, `--output=${image}`)).toMatchObject({ stderr: "", exitCode: 0 });
  expect(await runTool([jsc!, `--aotImagePath=${image}`, "-e", "0"])).toEqual({ lines: [], stderr: "", exitCode: 0 });
});

test.skipIf(!!whyShellSkipped)("jsc rejects a file that is not an image", async () => {
  using folder = tempDir("aot-engine-tests", { "nothing.image": "" });
  const image = join(String(folder), "nothing.image");
  const { stderr, exitCode } = await runTool([jsc!, `--aotImagePath=${image}`, "-e", "0"]);
  expect(stderr).toContain("Cannot use ");
  expect(exitCode).toBe(1);
});
