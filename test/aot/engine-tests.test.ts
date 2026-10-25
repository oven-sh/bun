// Runs the engine's own tests in Bun's CI: the IR text tests and the native tests that were packed with the WebKit this
// Bun was linked against. `testaot all` runs them in one go, which takes longer than one test may: here the IR text tests
// are one test and the native tests four, each a part of the list, at the same time.
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
import { isArm64, isASAN, isCI, isMacOS, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { comeInParts } from "./engine-tests-in-parts";
import { run as runCommand } from "./harness/run";
import { engineTests, jsc, scriptSkipReason, testaot, toolEnv } from "./shell/tools";

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

// 89 test files of this folder skip themselves where a tool is missing: collector-stress/, heat/, bad-time/, generated-code,
// and this one. CI packs the tools beside Bun; AOT_TOOLS=required says the same of any other place.
test.skipIf(isWindows || (!isCI && process.env.AOT_TOOLS !== "required"))("no tool is missing", () => {
  expect([whyNativeTestsSkipped, whyShellSkipped, scriptSkipReason].filter(why => why !== undefined)).toEqual([]);
});

async function runTool(cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, undefined, toolEnv);
  return { lines: stdout.split(/\r?\n/).filter(line => line !== ""), stderr, exitCode };
}

const run = (...args: string[]) => runTool([testaot!, ...args]);

// TODO: on Windows the tests that run a program in the shell, or in a child of testaot, ended with "CannotMapCode" while an image had to be
// brought to its address. There it no longer has one. "jsc takes an image that testaot wrote" runs on Windows; the others follow once it passes.
const shellTakesNoImage = isWindows;
// TODO: these two fail on Windows alone, and why is not known. They are the two that retype a value behind the parser (`f0:v3`).
const unexplainedOnWindows = [
  "represent/operand-wider-than-its-operation-takes.ir",
  "select/builtin-call-whose-operand-lost-its-type.ir",
];
const isKnownOnWindows = (line: string) =>
  line.includes(": run-in-shell: ") ||
  unexplainedOnWindows.some(file => line.replaceAll("\\", "/").includes(`/${file}:`));

// TODO: on arm64 it prints another output.
const notYetOnArm64 = isArm64 ? ["dictionary-access-by-name/programs/uncacheable-dictionary-files-nothing"] : [];
// TODO: on the Intel Macs of CI the four parts of the native tests do not end within the five minutes that the runner gives a file.
const nativeTestsOutlastTheRunner = isMacOS && !isArm64;
// The runner gives a file twice the time under a sanitizer.
const limit = isASAN ? 480_000 : 290_000;

function expectEveryTestPassed({ lines, stderr, exitCode }: Awaited<ReturnType<typeof run>>) {
  if (shellTakesNoImage && lines.some(line => line.startsWith("FAIL ") && isKnownOnWindows(line))) {
    expect(lines.filter(line => line.startsWith("FAIL ") && !isKnownOnWindows(line))).toEqual([]);
    return;
  }
  const failed = lines.filter(line => line.startsWith("FAIL "));
  const isOnTheList = (line: string) => notYetOnArm64.some(name => line.startsWith(`FAIL ${name}: `));
  if (failed.length && failed.every(isOnTheList)) {
    expect(lines.at(-1)).toMatch(/^[1-9][0-9]* passed, [1-9][0-9]* failed, [0-9]+ todo$/);
    return;
  }
  // In front of its FAIL line a native test that crashed has said which check failed, and where.
  const hasFailed = lines.some(line => line.startsWith("FAIL "));
  expect(hasFailed ? lines.filter(line => !/^(PASS|TODO|SKIP|  still fails:) /.test(line)).slice(-60) : []).toEqual([]);
  // After a crash, lastLine names the native test and stderr has the failed check: stderr is listed so that it is printed.
  expect({ lastLine: lines.at(-1), stderr, exitCode }).toEqual({
    lastLine: expect.stringMatching(/^[1-9][0-9]* passed, 0 failed, [0-9]+ todo$/),
    stderr: expect.any(String),
    exitCode: 0,
  });
}

(whyEngineTestsSkipped || comeInParts ? test.skip : test.concurrent)(
  "the engine's IR text tests pass",
  async () => {
    expectEveryTestPassed(await run("run", engineTests!));
  },
  limit,
);

// It judges nothing: the log of a run on Windows is the only place where their output can be read.
test.skipIf(!!whyEngineTestsSkipped || !isWindows).each(unexplainedOnWindows)(
  "what %s prints on Windows",
  async file => {
    const { lines, stderr } = await run("run", join(engineTests!, file), "--show-output");
    console.error(`UNEXPLAINED ON WINDOWS ${file}:\n${[...lines, stderr].join("\n")}`);
  },
);

(whySkipped || comeInParts ? test.skip : test.concurrent)(
  "the engine's IR text tests of Bun's entries pass",
  async () => {
    expectEveryTestPassed(await run("run", join(import.meta.dir, "engine-tests")));
  },
  limit,
);

const parts = 4;
const cannotRunNativeTests = shellTakesNoImage || nativeTestsOutlastTheRunner;
(whyNativeTestsSkipped || comeInParts ? test.skip : cannotRunNativeTests ? test.todo : test.concurrent).each(
  Array.from({ length: parts }, (_, index) => index + 1),
)(
  `the engine's native tests pass: part %d of ${parts}`,
  async part => {
    expectEveryTestPassed(await run("native", `--part=${part}/${parts}`));
  },
  limit,
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
