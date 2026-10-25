// Runs the engine's own tests in Bun's CI: the IR text tests and the native tests that were packed with the WebKit this
// Bun was linked against. `testaot all` runs them in one go, which takes longer than the runner gives a file: the long
// commands are test files of their own (./engine-test-commands.ts), and this file has the short ones.
// engine-tests/ has the IR text tests that name entries of Bun's table of built-ins.
// With a sanitizer they take several times as long: ./engine-tests-in-parts.ts runs them there.
//
// Needs `testaot`, the `aot-tests` folder for two of the tests, and `jsc` for two: the engine's own tests want it in the
// folder of `testaot`. shell/tools.ts says where each is looked for. A test whose tool is missing is skipped, and stderr
// says which tool.
//   $TESTAOT run <aot/tests>/passes/sink-allocations --jobs=1     one folder, serially, each path printed before it runs
//   $TESTAOT native <filter> --part=2/4                           every fourth of the native tests whose name holds the filter, from the second on
import { expect, test } from "bun:test";
import { existsSync } from "fs";
import { isCI, isWindows, tempDir } from "harness";
import { join } from "path";
import {
  run,
  runTool,
  unexplainedOnWindows,
  whyEngineTestsSkipped,
  whyNativeTestsSkipped,
  whyShellSkipped,
  whySkipped,
} from "./engine-test-commands";
import { engineTests, jsc, scriptSkipReason } from "./shell/tools";

const program = join(engineTests ?? "", "driver", "check-next.ir");
for (const why of new Set([whySkipped, whyEngineTestsSkipped, whyNativeTestsSkipped, whyShellSkipped])) {
  if (why) console.error(`SKIPPED: test/aot/engine-tests.test.ts: ${why}`);
}

// 89 test files of this folder skip themselves where a tool is missing: collector-stress/, heat/, bad-time/, generated-code,
// and this one. CI packs the tools beside Bun; AOT_TOOLS=required says the same of any other place.
test.skipIf(isWindows || (!isCI && process.env.AOT_TOOLS !== "required"))("no tool is missing", () => {
  expect([whyNativeTestsSkipped, whyShellSkipped, scriptSkipReason].filter(why => why !== undefined)).toEqual([]);
});

// It judges nothing: the log of a run on Windows is the only place where their output can be read.
test.skipIf(!!whyEngineTestsSkipped || !isWindows).each(unexplainedOnWindows)(
  "what %s prints on Windows",
  async file => {
    const folder = existsSync(join(engineTests!, file)) ? engineTests! : join(import.meta.dir, "engine-tests");
    const { lines, stderr } = await run("run", join(folder, file), "--show-output");
    console.error(`UNEXPLAINED ON WINDOWS ${file}:\n${[...lines, stderr].join("\n")}`);
  },
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

test.skipIf(!!whyEngineTestsSkipped || !!whyShellSkipped)("jsc takes an image that testaot wrote", async () => {
  using folder = tempDir("aot-engine-tests", {});
  const image = join(String(folder), "program.image");
  const withEntryPoint = join(engineTests!, "pipeline", "a-literal-string-past-the-limit-is-tested-for.ir");
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
