import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { beforeAll, testOneByOne as test } from "../supported";
import { run } from "./run";

// A test run is built as one program. The files of this project lie in three layers: packages, what else the test files import, and the test files.
// Here classes, closures, objects with typed fields, errors, iterators, proxies, modules and the library's own state go from each to the others, each body seven times.
// A check prints what it saw, so a wrong value shows where no `expect` asks for it. The files are packages and test files only in the copy that is run.
const folder = join(import.meta.dir, "..", "three-layers");
const files = Object.fromEntries(
  readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => join(entry.parentPath, entry.name))
    .map(path => [
      path
        .slice(folder.length + 1)
        .replaceAll("\\", "/")
        .replace(/^packages\//, "node_modules/")
        .replace(/^tests\/(.*)\.fixture\./, "test/$1.test."),
      readFileSync(path, "utf8"),
    ]),
);
const testFiles = Object.keys(files)
  .filter(path => path.startsWith("test/"))
  .sort();

// What a run that was stopped says of it. Without these lines an abort reads "exitCode 134" and a result that is missing.
const stop =
  /ASSERTION FAILED|Unchecked JS exception|This scope can throw|unchecked as of this scope|AddressSanitizer|LeakSanitizer|panic[:(]|Segmentation fault/;
// Behind its last test file a run says once more which tests it skipped, left to do or failed.
const saysOnceMore = /^\d+ tests (skipped|todo|failed):$/;
// What `bun test` counts at the end of a run: the tests by how they ended, the errors outside of tests, the snapshots, the calls of expect() and the files.
const isCount =
  /^ *\d+ (pass|skip|todo|fail|errors?|expect\(\) calls)$|^ *\d+ snapshots, |^snapshots: |^Ran \d+ tests? across \d+ files?\. /;
// The times differ from run to run.
const withoutItsTime = (line: string) => line.replace(/ \[[\d.]+m?s\]$/, "");
// Behind its counts a compiled run says where it did not run the code that an executable runs. ../three-layers/tests/39-loader.fixture.ts imports a file under a query, and nothing else is said.
const saidBehindTheCountsOfACompiledRun = [
  "1 compiled file ran from source in the interpreter during this run. Tests that used them didn't test the code your executable runs:",
  "  src/cycle-b.ts?one: it was imported under a query, while test/39-loader.test.ts ran",
];

async function seenIn(words: string | undefined, flags: string[] = [], more: Record<string, string> = {}) {
  using dir = tempDir("aot-three-layers", files);
  // Not CI: each run writes the snapshot that it is held to.
  const env = { ...bunEnv, CI: "false", BUN_DEBUG_TEST_AOT_WORDS: words, ...more };
  // Several runs at once: on a busy machine a check that waits for a file watcher has passed the five seconds that a test has.
  const command = [bunExe(), "test", "--isolate", "--timeout=60000", ...flags];
  const { stdout, stderr, exitCode } = await run(command, String(dir), env);
  const seen = stdout.split("\n").filter(line => line.startsWith("RESULT|"));
  const said = stderr.split("\n");
  // How each test ended, below the test file that declares it. A run takes the files in the order in which the folder lists them, so they stand here in the order of their names.
  const tests: Record<string, string[]> = Object.fromEntries(testFiles.map(file => [file, []]));
  let file = "before the first test file";
  for (const line of said) {
    if (saysOnceMore.test(line)) break;
    if (line.endsWith(":") && testFiles.includes(line.slice(0, -1))) file = line.slice(0, -1);
    else if (/^\((pass|fail|skip|todo)\) /.test(line)) (tests[file] ??= []).push(withoutItsTime(line));
  }
  const counts = said.filter(line => isCount.test(line)).map(line => withoutItsTime(line).trim());
  const lastCount = said.findLastIndex(line => isCount.test(line));
  const behindTheCounts = lastCount < 0 ? [] : said.slice(lastCount + 1).filter(Boolean);
  const stopped = said.filter(line => stop.test(line)).map(line => line.trim());
  return { seen: seen.sort(), tests, counts, behindTheCounts, stopped: stopped.slice(0, 12), exitCode };
}

type Run = Awaited<ReturnType<typeof seenIn>>;
type Way = { words?: string; env?: Record<string, string> };

/** Every way is a compiled run of the whole project, held to a plain run. */
export function answerAsPlainBunTest(ways: Record<string, Way>) {
  // The plain run waits for nothing that a compiled run makes. So it is started here and awaited where a case needs it: the first compiled run runs beside it, not behind it.
  let plain: Promise<Run>;
  beforeAll(() => {
    plain = seenIn(undefined);
    // The case that awaits the run says what it threw. Without a handler until then, the error would fail the case that runs at that moment.
    plain.catch(() => {});
  });

  // A case starts its own run, so a filter that leaves the case out leaves its run out too.
  test.each(Object.entries(ways))("the project answers as plain bun test: %s", async (way, { words, env }) => {
    const { seen, ...answered } = await seenIn(words, ["--aot"], env);
    if (answered.stopped.length) console.error(`${way}: the run was stopped:\n${answered.stopped.join("\n")}`);
    const { seen: seenByPlain, ...expected } = await plain;
    // What the checks printed stands last. It is more than a megabyte, and behind a megabyte `expect` prints a list as `[Array]` and an object as `[Object]`, whatever they hold.
    expect([answered, seen]).toEqual([
      { ...expected, behindTheCounts: saidBehindTheCountsOfACompiledRun },
      seenByPlain,
    ]);
  });

  // Behind the compiled runs: in front of them this case would wait for the plain run while no compiled run has begun.
  test("plain bun test answers", async () => {
    const { seen, tests, counts, behindTheCounts, stopped, exitCode } = await plain;
    expect(stopped).toEqual([]);
    // Every test file has run, and each of its tests has passed but the two that ../three-layers/tests/38-each.fixture.ts skips and leaves to do.
    expect(testFiles.filter(file => !tests[file].length)).toEqual([]);
    const notPassed = Object.entries(tests).flatMap(([file, lines]) =>
      lines.filter(line => !line.startsWith("(pass) ")).map(line => `${file}: ${line}`),
    );
    expect(notPassed).toEqual(["test/38-each.test.ts: (skip) skipped", "test/38-each.test.ts: (todo) to do"]);
    // The numbers of the project as it stands: a check that is added to it changes them.
    expect({ printed: seen.length, counts }).toEqual({
      printed: 526,
      counts: [
        "447 pass",
        "1 skip",
        "1 todo",
        "0 fail",
        "snapshots: +7 added",
        "352 expect() calls",
        `Ran 449 tests across ${testFiles.length} files.`,
      ],
    });
    expect(behindTheCounts).toEqual([]);
    expect(exitCode).toBe(0);
  });
}
