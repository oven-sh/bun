// Runs the tests of the compiler's engine: WebKit's Source/JavaScriptCore/aot/tests, and ../engine-tests: the IR tests that name entries of
// Bun's table of built-ins. `testaot` runs them. CI packs it beside the Bun under test, with `jsc` and the folder `aot-tests`.
//
//   testaot      $TESTAOT, or beside the Bun under test, or in build/release-local, or in build/release
//   aot-tests    $AOT_ENGINE_TESTS, or beside the Bun under test, or aot/tests in $BUN_WEBKIT_PATH or vendor/WebKit
//
// By hand:
//   testaot run <file or folder>.. --show-output      IR tests: a .ir file says what is run on it and what must be printed
//   testaot native <part of a name>                   tests written in C++
import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, isCI, isWindows, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { declare } from "../harness/capabilities";
import { slot, slots } from "../harness/commands";
import { unsupported } from "../harness/compiler";
import { sharedSlot } from "../harness/shared-slots";
import { findTool } from "../shell/find-tools";

const repository = join(import.meta.dir, "..", "..", "..");
const besideBun = dirname(bunExe());
const suffix = isWindows ? ".exe" : "";

export const testaot = process.env.TESTAOT ?? findTool(bunExe(), "testaot");
export const jsc = process.env.JSC ?? findTool(bunExe(), "jsc");
export const engineTests =
  process.env.AOT_ENGINE_TESTS ??
  [
    join(besideBun, "aot-tests"),
    ...[process.env.BUN_WEBKIT_PATH, join(repository, "vendor", "WebKit")]
      .filter(path => path !== undefined)
      .map(path => join(path, "Source", "JavaScriptCore", "aot", "tests")),
  ].find(existsSync);
const engineTestsOfBun = join(import.meta.dir, "..", "engine-tests");

// Neither tool destroys its VM before it exits.
export const toolEnv = bunEnv.ASAN_OPTIONS
  ? { ...bunEnv, ASAN_OPTIONS: `${bunEnv.ASAN_OPTIONS}:detect_leaks=0` }
  : bunEnv;

// abort() prints nothing, and on Linux WTF's CRASH() is std::abort(). With handle_abort=1 a sanitizer prints the caller's stack.
export const commandEnv = toolEnv.ASAN_OPTIONS
  ? { ...toolEnv, ASAN_OPTIONS: `${toolEnv.ASAN_OPTIONS}:handle_abort=1` }
  : toolEnv;

// The tool's own output is discarded. Signals used to suspend threads are passed through. A noreturn crash function has no return address, so break on entry.
const debuggerCommands = [
  "set pagination off",
  "set breakpoint pending on",
  "set inferior-tty /dev/null",
  "handle all nostop noprint pass",
  "handle SIGABRT SIGILL SIGBUS SIGFPE SIGSEGV stop print",
  "break WTF::CrashOnOverflow::crash",
  "break WTFCrashWithInfo",
  "run",
  "bt 40",
];

/**
 * Reruns a command that a signal killed without any stderr output under gdb, if gdb is installed, and returns the backtrace.
 * An intermittent crash will usually not repeat; then it says so and where core dumps go.
 */
export async function describeSilentCrash(
  cmd: string[],
  cwd: string | undefined,
  env: Record<string, string | undefined>,
) {
  const coreDumps = existsSync("/proc/sys/kernel/core_pattern")
    ? `core_pattern is ${readFileSync("/proc/sys/kernel/core_pattern", "utf8").trim()}`
    : "where core dumps go is unknown";
  const gdb = isWindows ? null : Bun.which("gdb");
  if (!gdb) return `no stderr output; gdb is not installed; ${coreDumps}`;
  await using rerun = Bun.spawn({
    cmd: [gdb, "-q", "-batch", ...debuggerCommands.flatMap(command => ["-ex", command]), "--args", ...cmd],
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 600_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr] = await Promise.all([rerun.stdout.text(), rerun.stderr.text(), rerun.exited]);
  const backtrace = `${stdout}\n${stderr}`
    .split("\n")
    .filter(line => /^(#\d+ |Thread \d+ .*(received signal|hit Breakpoint)|Program |\[Inferior )/.test(line));
  return `no stderr output; ${coreDumps}; rerun under gdb:\n${backtrace.join("\n")}`;
}

export const whyNoTestaot = unsupported ?? (testaot ? undefined : "there is no testaot");
export const whyNoEngineTests = whyNoTestaot ?? (engineTests ? undefined : "there is no folder aot-tests");
/** `run-in-shell` and the native tests start the `jsc` that lies beside `testaot`. */
export const whyNoShell =
  whyNoTestaot ??
  (existsSync(join(dirname(testaot!), "jsc" + suffix)) ? undefined : "there is no jsc in the folder of testaot");
export const whyNoNativeTests = whyNoEngineTests ?? whyNoShell;

export async function runTool(cmd: string[], cwd?: string, env: Record<string, string | undefined> = {}) {
  await using child = Bun.spawn({
    cmd,
    cwd,
    env: { ...toolEnv, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, written, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const everyLine = stdout.split(/\r?\n/);
  // A command that rejects its arguments prints that as its first line, does nothing else, and exits with 0.
  if (exitCode === 0 && /^(error: )?(bad|missing) argument\b/.test(everyLine[0]))
    throw new Error(`${cmd.join(" ")}: ${everyLine[0]}`);
  const stderr =
    child.signalCode && !written.trim() ? await describeSilentCrash(cmd, cwd, { ...toolEnv, ...env }) : written;
  return { lines: everyLine.filter(line => line !== ""), everyLine, stderr, exitCode };
}
// These run tests. Some of their child processes crash on purpose, and the tests check the signal.
const commandsThatStartTests = new Set(["native", "all", "run"]);
export const run = (...args: string[]) =>
  runTool([testaot!, ...args], undefined, commandsThatStartTests.has(args[0]) ? {} : commandEnv);

/**
 * A FAIL line names the pattern that matched nothing, and some name the line of the output that it was held against.
 * This prints the start of what each command of the file printed, and the lines around those.
 */
async function printOutputOfFailedTests(lines: string[], cwd?: string) {
  const files = new Set(lines.flatMap(line => line.match(/^FAIL (.+?\.ir):\d+: /)?.[1] ?? []));
  for (const file of [...files].slice(0, 8)) {
    const named = lines
      .filter(line => line.startsWith(`FAIL ${file}:`))
      .flatMap(line => /\boutput line (\d+) /.exec(line)?.[1] ?? [])
      .map(Number);
    const { everyLine, stderr } = await runTool([testaot!, "run", file, "--show-output"], cwd);
    let at = Infinity;
    const shown = everyLine.flatMap(line => {
      at = line.startsWith("OUTPUT ") ? 0 : at + 1;
      if (at <= 20) return [line];
      return named.some(number => Math.abs(at - number) <= 8) ? [`${at}: ${line}`] : [];
    });
    console.error([...shown, stderr].join("\n"));
  }
}

// Each is what a FAIL line has between "FAIL " and ": ", with forward slashes, under a TODO that says what it waits for.
const failsToday: string[] = [];

/** How many were run: those that passed, and those that fail under a `# TODO:`. ./what-a-todo-of-an-ir-test-stands-for.test.ts shows what such a line stands for. */
export async function expectEveryTestPasses(args: string[], cwd?: string, env?: Record<string, string>) {
  const { lines, stderr, exitCode } = await runTool([testaot!, ...args], cwd, env);
  await printOutputOfFailedTests(lines, cwd);
  const failed = lines.filter(
    line =>
      line.startsWith("FAIL ") && !failsToday.some(name => line.replaceAll("\\", "/").startsWith(`FAIL ${name}: `)),
  );
  // In front of its FAIL line a native test has said which check failed, and where.
  const shown = lines.filter(line => !/^(PASS|TODO|SKIP|  still fails:) /.test(line));
  expect(failed.length ? shown.slice(-60) : []).toEqual([]);
  // A file of IR tests has a FAIL line for each of its commands that fails, and counts once in the last line.
  const listed = new Set(
    lines.filter(line => line.startsWith("FAIL ")).map(line => /^FAIL (.+?\.ir):\d+: /.exec(line)?.[1] ?? line),
  ).size;
  expect({ lastLine: lines.at(-1), stderr, exitCode }).toEqual({
    lastLine: expect.stringMatching(new RegExp(`^[1-9][0-9]* passed, ${listed} failed, [0-9]+ todo$`)),
    stderr: expect.any(String),
    exitCode: listed ? 1 : 0,
  });
  // A file with a line `# AS-USERS-BUILD:` shows nothing where the checks are on from outside: testaot does not run it, says what turns them on, and counts it among
  // the passed. Its own assertions and sanitizer may; a check word may where this call passes one. Anything else leaves the file unrun in a run that looks green.
  const asksForCheck = args.some(arg => arg.startsWith("--option=check="));
  const notRun = [...lines, ...stderr.split(/\r?\n/)]
    .filter(line => line.startsWith("NOT RUN, not as users build here: "))
    .filter(line => !/^NOT RUN, not as users build here: this testaot has (assertions|the sanitizer): /.test(line))
    .filter(line => !(asksForCheck && line.startsWith("NOT RUN, not as users build here: the command line asks for a check: ")));
  expect(notRun).toEqual([]);
  const [, passed, todo] = /^(\d+) passed, \d+ failed, (\d+) todo$/.exec(lines.at(-1)!)!;
  return Number(passed) + Number(todo);
}

export const skipOrFail = (why: string) =>
  // CI packs the tools wherever Bun has the compiler.
  isCI && !unsupported
    ? test(`${why}: does ../harness/tests-that-start-tools-of-the-engine.ts see that this file imports ./testaot.ts?`, () =>
        expect(why).toBeUndefined())
    : test.skip(`${why}: test/aot/engine/testaot.ts says where it is looked for`, () => {});

// A command line of Windows holds 32,767 characters.
const longestCommandLine = isWindows ? 24_000 : 200_000;
function inCommandLines(paths: string[]) {
  const lists: string[][] = [[]];
  let length = 0;
  for (const path of paths) {
    if (length + path.length + 1 > longestCommandLine) {
      lists.push([]);
      length = 0;
    }
    lists.at(-1)!.push(path);
    length += path.length + 1;
  }
  return lists.filter(list => list.length);
}

// Each takes as long as two hundred others, and `testaot run` ends a process of sixteen that has printed nothing for 300 seconds. The n-th has ir-alone-n.test.ts.
const alone = [
  "link/regexp-texts/a-chain-of-prototypes-is-paid-for-by-its-length.ir",
  "link/regexp-texts/a-name-that-a-long-chain-lacks-is-paid-for.ir",
];

export function irTestAlone(nth: number) {
  if (whyNoEngineTests) return void skipOrFail(whyNoEngineTests);
  test(alone[nth - 1]!, async () => void (await expectEveryTestPasses(["run", alone[nth - 1]!], engineTests)), 600_000);
}

/** Every `parts`-th IR test of each folder, from the `part`-th on. A new test needs no list: it is in one of the parts. */
export function irTests(part: number, parts: number) {
  if (whyNoEngineTests) return void skipOrFail(whyNoEngineTests);
  expect(alone.filter((_, at) => !existsSync(join(import.meta.dir, `ir-alone-${at + 1}.test.ts`)))).toEqual([]);
  for (const [folder, whose] of [
    [engineTests!, "the engine"],
    [engineTestsOfBun, "Bun"],
  ] as const) {
    const mine = readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter(path => path.endsWith(".ir") && !alone.includes(path.replaceAll("\\", "/")))
      .sort()
      .filter((_, index) => index % parts === part - 1);
    test(`${mine.length} IR tests of ${whose}`, async () => {
      for (const paths of inCommandLines(mine)) await expectEveryTestPasses(["run", ...paths], folder);
    }, 600_000);
  }
}

// `testaot native` runs one test at a time, and one test takes a hundred times as long as another. So a file has many small shares, and
// as many of them run at once as there are processors: whoever is done takes the next. CI runs several of these files at once, and
// a share keeps its processor busy, so the files count their shares together.
const sharesOfAFile = 16;

/** Every `parts`-th native test, from the `part`-th on. */
export function nativeTests(part: number, parts: number) {
  if (whyNoNativeTests) return void skipOrFail(whyNoNativeTests);
  const sharesUnderWay = join(dirname(testaot!), "native-tests-under-way");
  const images = tempDir("native-test-images", {});
  afterAll(() => images[Symbol.dispose]());
  const env = isWindows ? {} : { AOT_TEST_IMAGES: String(images) };
  for (let slice = 0; slice < sharesOfAFile; slice++) {
    const share = `${(part - 1) * sharesOfAFile + slice + 1}/${parts * sharesOfAFile}`;
    test.concurrent(
      `native tests: --part=${share}`,
      () =>
        slot(() =>
          sharedSlot(sharesUnderWay, slots, () => expectEveryTestPasses(["native", `--part=${share}`], undefined, env)),
        ),
      600_000,
    );
  }
}

declare("testaot", () => whyNoTestaot);
declare("the tests of the engine", () => whyNoNativeTests);
