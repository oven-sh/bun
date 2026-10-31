// Runs the tests of the compiler's engine: WebKit's Source/JavaScriptCore/aot/tests, and ../engine-tests, which name entries of Bun's table of built-ins.
// `testaot` runs them. CI packs it beside the Bun under test, with `jsc` and the folder `aot-tests`.
//
//   testaot      $TESTAOT, or beside the Bun under test, or in build/release-local, or in build/release
//   aot-tests    $AOT_ENGINE_TESTS, or beside the Bun under test, or aot/tests in $BUN_WEBKIT_PATH or vendor/WebKit
//
// By hand:
//   testaot run <file or folder>.. --show-output      IR tests: a .ir file says what is run on it and what must be printed
//   testaot native <part of a name>                   tests written in C++
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isCI, isMusl, isWindows } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { countsInstructions } from "../analysis-scaling/measure-check";
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
const testsOfBunsEntries = join(import.meta.dir, "..", "engine-tests");

// Neither tool destroys its VM before it exits.
export const toolEnv = bunEnv.ASAN_OPTIONS
  ? { ...bunEnv, ASAN_OPTIONS: `${bunEnv.ASAN_OPTIONS}:detect_leaks=0` }
  : bunEnv;

export const whyNoTestaot = unsupported ?? (testaot ? undefined : "there is no testaot");
export const whyNoEngineTests = whyNoTestaot ?? (engineTests ? undefined : "there is no folder aot-tests");
export const whyNoNativeTests =
  whyNoEngineTests ??
  (existsSync(join(dirname(testaot!), "jsc" + suffix)) ? undefined : "there is no jsc in the folder of testaot");

export async function runTool(cmd: string[], cwd?: string) {
  await using child = Bun.spawn({ cmd, cwd, env: toolEnv, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  const everyLine = stdout.split(/\r?\n/);
  return { lines: everyLine.filter(line => line !== ""), everyLine, stderr, exitCode };
}
export const run = (...args: string[]) => runTool([testaot!, ...args]);

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

// TODO: it prints something else on arm64.
const failsToday = isArm64 ? ["dictionary-access-by-name/programs/uncacheable-dictionary-files-nothing"] : [];

// With musl a run of these loops costs some 100,000 instructions more than with glibc, however many turns it makes (ten times the turns
// moved it from 90,000 to 150,000). The code of the loop is the same, and most rows make 100,000 turns, so a row can read up to 1 instruction higher.
const isOverABoundByTheCostOfMusl = (line: string) => {
  const found = /at most ([0-9.]+) instructions; nearest: .*?, ([0-9.]+) instructions/.exec(line);
  return isMusl && found !== null && Number(found[2]) - Number(found[1]) <= 1;
};

async function expectEveryTestPasses(args: string[], cwd?: string) {
  const { lines, stderr, exitCode } = await runTool([testaot!, ...args], cwd);
  await printOutputOfFailedTests(lines, cwd);
  const failed = lines.filter(
    line =>
      line.startsWith("FAIL ") &&
      !failsToday.some(name => line.startsWith(`FAIL ${name}: `)) &&
      !isOverABoundByTheCostOfMusl(line),
  );
  // In front of its FAIL line a native test has said which check failed, and where. A row that musl is forgiven is no part of the failure.
  const shown = lines.filter(
    line => !/^(PASS|TODO|SKIP|  still fails:) /.test(line) && !isOverABoundByTheCostOfMusl(line),
  );
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
}

const skipOrFail = (why: string) =>
  // CI packs the tools wherever Bun has the compiler.
  isCI && !isWindows && !unsupported
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

/** Every `parts`-th IR test, from the `part`-th on. A new test needs no list: it is in one of the parts. */
export function irTests(part: number, parts: number) {
  if (whyNoEngineTests) return void skipOrFail(whyNoEngineTests);
  let index = 0;
  for (const folder of [engineTests!, testsOfBunsEntries]) {
    const mine = readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter(path => path.endsWith(".ir"))
      .sort()
      .filter(() => index++ % parts === part - 1);
    test(`${mine.length} IR tests of ${folder === engineTests ? "the engine" : "test/aot/engine-tests"}`, async () => {
      for (const paths of inCommandLines(mine)) await expectEveryTestPasses(["run", ...paths], folder);
    }, 600_000);
  }
}

/**
 * The IR tests that bound a count of the hardware's instruction counter. Where the counter cannot be read they pass without a count,
 * so ir-<n>.test.ts does not judge the bounds on such a machine.
 */
export function irTestsWithInstructionBounds() {
  if (whyNoEngineTests) return void skipOrFail(whyNoEngineTests);
  for (const folder of [engineTests!, testsOfBunsEntries]) {
    const mine = readdirSync(folder, { recursive: true, encoding: "utf8" })
      .filter(path => path.endsWith(".ir") && readFileSync(join(folder, path), "utf8").includes("aotInstructionCount"))
      .sort();
    test.skipIf(!countsInstructions())(
      `${mine.length} IR tests of ${folder === engineTests ? "the engine" : "test/aot/engine-tests"}`,
      async () => {
        expect(mine.length).toBeGreaterThan(0);
        for (const paths of inCommandLines(mine)) await expectEveryTestPasses(["run", ...paths], folder);
      },
      600_000,
    );
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
  for (let slice = 0; slice < sharesOfAFile; slice++) {
    const share = `${(part - 1) * sharesOfAFile + slice + 1}/${parts * sharesOfAFile}`;
    test.concurrent(
      `native tests: --part=${share}`,
      () => slot(() => sharedSlot(sharesUnderWay, slots, () => expectEveryTestPasses(["native", `--part=${share}`]))),
      600_000,
    );
  }
}
