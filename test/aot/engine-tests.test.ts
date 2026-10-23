// Runs the engine's own tests in Bun's CI: the IR text tests and the native tests that were packed with the WebKit this
// Bun was linked against. `testaot all` runs them in one go, which takes longer than one test may: here the IR text tests
// are one test and the native tests four, each a part of the list, at the same time.
// engine-tests/ has the IR text tests that name entries of Bun's table of built-ins.
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

// TODO: on Windows the shell of the pinned engine maps an image read-only and then cannot bring it to its address: "CannotMapCode".
// No test that runs a program in the shell, or in a child of testaot, can pass there until an engine that maps it copy-on-write is pinned.
const shellTakesNoImage = isWindows;
// TODO: these two fail on Windows alone, and why is not known. They are the two that retype a value behind the parser (`f0:v3`).
const unexplainedOnWindows = [
  "represent/operand-wider-than-its-operation-takes.ir",
  "select/builtin-call-whose-operand-lost-its-type.ir",
];
const isKnownOnWindows = (line: string) =>
  line.includes(": run-in-shell: ") ||
  unexplainedOnWindows.some(file => line.replaceAll("\\", "/").includes(`/${file}:`));

// TODO: on macOS the testaot of the pinned engine fails these in its own harness, not in the engine. Its child that uses an image has no
// SharedArrayBuffer (the first four), holds the code of the image in memory that is not executable (the next four), and stores into
// pages of the image that the loader has made read-only (the last three). They leave the list with the next engine that is pinned.
const failsInTheTestProgramItself = isMacOS
  ? [
      "locked-realm-members/program-writes-to-locked-members",
      "locked-realm-members/program-writes-to-species",
      "locked-realm-members/start-up-locks-members",
      "locked-realm-members/start-up-marks-instances-pristine",
      "naked-constructor/class-names-class-constructor",
      "native-module-exports/deferred-export-is-read-when-first-module-that-binds-it-is-linked",
      "native-module-exports/module-with-source-exports-properties-of-its-object",
      "native-module-exports/native-module-exports-what-host-lists",
      "global-bindings/worker-has-its-own-records",
      "image/instances/two-realms-have-instances",
      "saved-frame/skipped-words",
    ]
  : [];

// TODO: the test of the pinned engine looks for the function behind cc() of bun:ffi under the name that its binding had in src/js
// before the function had a schema. It leaves the list with the next engine that is pinned.
const looksForFormerNameOfAnEntry = ["builtin-table/marks"];

// TODO: what these expect of x86-64 was taken where a loop poll is a load that faults, which is Linux alone. On macOS a poll is a
// comparison with a call there too, and testaot has no word yet by which a test could say so.
const expectsLoopPollsThatFault =
  isMacOS && !isArm64
    ? [
        "codegen/compile-functions/outlinable-rare-code-everything-is-hot.ir",
        "codegen/compile-functions/outlinable-rare-code.ir",
        "codegen/loop-polls/a-loop-that-counts-up-to-the-length-of-a-view.ir",
        "codegen/loop-polls/loop-without-rotation.ir",
        "codegen/loop-polls/loops-that-count-up-to-a-length.ir",
        "codegen/loop-polls/rotated-loop.ir",
        "codegen/null-checks/narrow-references.ir",
        "codegen/prologue/a-tail-call-polls-without-a-frame.ir",
      ]
    : [];
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
  const isOnTheList = (line: string) =>
    [...failsInTheTestProgramItself, ...looksForFormerNameOfAnEntry].some(name => line.startsWith(`FAIL ${name}: `)) ||
    expectsLoopPollsThatFault.some(file => line.includes(`/${file}:`));
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

(whyEngineTestsSkipped ? test.skip : test.concurrent)(
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

(whySkipped ? test.skip : test.concurrent)(
  "the engine's IR text tests of Bun's entries pass",
  async () => {
    expectEveryTestPassed(await run("run", join(import.meta.dir, "engine-tests")));
  },
  limit,
);

const parts = 4;
const cannotRunNativeTests = shellTakesNoImage || nativeTestsOutlastTheRunner;
(whyNativeTestsSkipped ? test.skip : cannotRunNativeTests ? test.todo : test.concurrent).each(
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

test.skipIf(!!whyEngineTestsSkipped || !!whyShellSkipped).todoIf(shellTakesNoImage)(
  "jsc takes an image that testaot wrote",
  async () => {
    using folder = tempDir("aot-engine-tests", {});
    const image = join(String(folder), "program.image");
    const withEntryPoint = join(engineTests!, "pipeline", "a-literal-string-past-the-limit-is-tested-for.ir");
    expect(await run("compile", withEntryPoint, `--output=${image}`)).toMatchObject({ stderr: "", exitCode: 0 });
    expect(await runTool([jsc!, `--aotImagePath=${image}`, "-e", "0"])).toEqual({ lines: [], stderr: "", exitCode: 0 });
  },
);

test.skipIf(!!whyShellSkipped)("jsc rejects a file that is not an image", async () => {
  using folder = tempDir("aot-engine-tests", { "nothing.image": "" });
  const image = join(String(folder), "nothing.image");
  const { stderr, exitCode } = await runTool([jsc!, `--aotImagePath=${image}`, "-e", "0"]);
  expect(stderr).toContain("Cannot use ");
  expect(exitCode).toBe(1);
});
