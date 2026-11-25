// For test-runs-in-folders-*.test.ts. Each folder two levels below parallel-test-runs/ is a project with test files: parallel-test-runs/<area>/<what it shows>/. It is copied out of the tree and run twice, by
// `bun test` and by `bun test --aot`. What `bun test` prints is the specification: the lines that the tests print, how each test ends and the exit code must be equal.
// A project needs no expectation of its own. It prints what a wrong answer would change, or expects it in a test, which then fails in one run alone. A preload is named by a bunfig.toml in the folder.
// The test files of a project end in _test, which `bun test` finds: scripts/runner.node.ts takes every name that holds ".test" for a test of the repository.
// The packages of a project lie in a folder `installed`, which the copy has as `node_modules`: git ignores a folder of that name, and so does whatever carries this tree to another machine.
// A project waits for events, never for a time: on a busy machine every time is too short. A factory waits for a gate that the test opens, and a factory, a body or a timer that is waited for resolves a promise.
// Where nothing can say that nothing more comes, the test runs the event loop some 20 times (spinEventLoop): what a failure or a settled factory brings about comes in the first of them.
// A file flags.txt in the folder holds flags for both runs: `--isolate`.
// A file todo.txt in the folder, lines of the form `"<words>" | "<the words for them>": <why>`: the two runs differ today, and in that alone: one says the first words of a line where the other says the second.
// The project is run all the same. It fails by any other difference, and once the two runs agree: the file goes out.
// A file says.json in the folder, { why, printed, tests, exitCode }: `bun test` has more than one answer here, by how busy the machine is: the tests leave a call in flight that nobody awaits, and the run ends
// when they have ended. A compiled run has one answer, the one that `bun test` gives most often: it alone is run, and held to what the file says.
// A file one-thread.txt in the folder says why plain Bun reads the files of the project on one thread: with threads, files complete in the order in which the threads finish.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { test } from "../supported";
import { slots } from "./commands";
import { run } from "./run";
import { sharedSlot } from "./shared-slots";

const root = join(import.meta.dir, "..", "parallel-test-runs");
const holdsFile = (folder: string): boolean =>
  readdirSync(folder, { withFileTypes: true }).some(
    entry => !entry.isDirectory() || holdsFile(join(folder, entry.name)),
  );
const foldersIn = (folder: string) =>
  readdirSync(folder, { withFileTypes: true })
    // git holds no folder without a file: one that is left behind in a working tree is no project, nor is one that holds such folders alone.
    .filter(entry => entry.isDirectory() && holdsFile(join(folder, entry.name)))
    .map(entry => entry.name)
    .sort();
// `bun test` runs the files of a folder as the file system lists them. A project whose second file looks at what the first has left needs them in the order of their names.
const testFilesIn = (folder: string) =>
  (readdirSync(folder, { recursive: true }) as string[])
    .map(path => path.replaceAll("\\", "/"))
    .filter(path => /_test\.[cm]?[jt]sx?$/.test(path) && !path.split("/").includes("node_modules"))
    .sort()
    .map(path => "./" + path);

const flagsOf = (folder: string) =>
  existsSync(join(folder, "flags.txt"))
    ? readFileSync(join(folder, "flags.txt"), "utf8").split(/\s+/).filter(Boolean)
    : [];

const literalPackagesIn = (folder: string) =>
  (readdirSync(folder, { recursive: true }) as string[]).filter(path => path.split(/[\\/]/).includes("node_modules"));

// As isTestStrict() of scripts/runner.node.ts asks.
const takenForTestsOfTheRepository = (folder: string) =>
  (readdirSync(folder, { recursive: true }) as string[]).filter(
    path => /\.(c|m)?(j|t)sx?$/.test(basename(path)) && /\.test|spec\./.test(basename(path)),
  );

function markOf(folder: string) {
  if (!existsSync(join(folder, "todo.txt"))) return undefined;
  const lines = readFileSync(join(folder, "todo.txt"), "utf8").trimEnd().split(/\r?\n/);
  const marks = lines.map(line => {
    const [, one, other] = /^"([^"]+)" \| "([^"]+)": \S/.exec(line) ?? [];
    if (other === undefined) throw new Error(`${folder}/todo.txt has a line that is not of the form \`"<words>" | "<the words for them>": <why>\``);
    return [one, other];
  });
  return (outcome: unknown) =>
    JSON.parse(marks.reduce((text, [one, other]) => text.replaceAll(one, other), JSON.stringify(outcome)));
}

function saidOf(folder: string) {
  if (!existsSync(join(folder, "says.json"))) return undefined;
  const { printed, tests, exitCode } = JSON.parse(readFileSync(join(folder, "says.json"), "utf8"));
  return { printed, tests, exitCode, lastWords: [] };
}

function layPackages(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name === "installed" ? "node_modules" : entry.name;
    if (name !== entry.name) renameSync(join(folder, entry.name), join(folder, name));
    layPackages(join(folder, name));
  }
}

// A file under.txt in the folder holds words for BUN_DEBUG_TEST_AOT_WORDS, `testing=CheckWalkAtRunTime,check=Validate`: the project is compiled and run once more under them, and held to the same.
// It is the witness of a fault that showed only there. AOT_TEST_RUN_WORDS puts every compiled run of every project under its words: how a bench looks for what nobody knows of yet.
// bunEnv drops each BUN_DEBUG_ variable of whoever runs this file.
const wordsOfAll = process.env.AOT_TEST_RUN_WORDS ?? "";

// CI runs three of these files at once, and each of their tests starts two runs, so that six runs stand beside one another for each processor. The files count their runs together.
const runsUnderWay = join(dirname(bunExe()), "test-runs-under-way");

async function outcomeOf(dir: string, words: string, ...flags: string[]) {
  layPackages(dir);
  // As users run it: whoever runs this file may have switched the thread off that reads the texts.
  const oneThread = !flags.includes("--aot") && existsSync(join(dir, "one-thread.txt")) ? "1" : "0";
  const env = {
    ...bunEnv,
    NO_COLOR: "1",
    BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: oneThread,
    BUN_DEBUG_TEST_AOT_WORDS: words,
  };
  const { stdout, stderr, exitCode } = await sharedSlot(runsUnderWay, slots, () =>
    run([bunExe(), "test", ...flags, ...testFilesIn(dir)], dir, env),
  );
  return {
    printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test v")),
    // The times differ from run to run.
    tests: stderr
      .split("\n")
      .filter(line => /^\((pass|fail|skip|todo)\) /.test(line))
      .map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    exitCode,
    // A run that dies says why here, and nowhere else.
    lastWords: exitCode > 1 ? stderr.split("\n").filter(Boolean).slice(-12) : [],
  };
}

/**
 * One file took ten minutes, and CI's runner tries a file that fails four times. So `parts` files share the projects, each a stretch of them in the order of their names.
 */
export function testRunsInFolders(part: number, parts: number) {
  const projects = foldersIn(root).flatMap(area => foldersIn(join(root, area)).map(project => [area, project]));
  const stretch = Math.ceil(projects.length / parts);
  for (const [area, project] of projects.slice((part - 1) * stretch, part * stretch)) {
    test(`${area}/${project}`, async () => {
      // See the head of this file: such a folder stays behind where the tree is carried, and the project then runs without its packages.
      expect(literalPackagesIn(join(root, area, project)).slice(0, 3)).toEqual([]);
      // See the head of this file: the runner would run such a file where it lies, by itself and without the packages of its project, and here it would be no test file that is named in its order.
      expect(takenForTestsOfTheRepository(join(root, area, project)).slice(0, 3)).toEqual([]);
      const said = saidOf(join(root, area, project));
      if (said) {
        using dir = tempDir("aot-test-run-in-folder", join(root, area, project));
        expect(await outcomeOf(String(dir), wordsOfAll, "--aot", ...flagsOf(join(root, area, project)))).toEqual(said);
        return;
      }
      // A folder for each run: a build leaves files beside what it reads.
      using plainDir = tempDir("aot-test-run-in-folder", join(root, area, project));
      using compiledDir = tempDir("aot-test-run-in-folder", join(root, area, project));
      const flags = flagsOf(join(root, area, project));
      const [plain, compiled] = await Promise.all([
        outcomeOf(String(plainDir), "", ...flags),
        outcomeOf(String(compiledDir), wordsOfAll, "--aot", ...flags),
      ]);
      // Neither run is made again: where plain Bun has more than one answer the project fails, and what it races for is fixed in the project.
      const butForItsMark = markOf(join(root, area, project));
      // A run in which plain says nothing would pass for the wrong reason: it prints, or a test of it passes by what it expects.
      expect(plain.printed.length + plain.tests.filter(line => line.startsWith("(pass) ")).length).toBeGreaterThan(0);
      expect(plain.tests.length).toBeGreaterThan(0);
      if (butForItsMark) {
        expect(butForItsMark(compiled)).toEqual(butForItsMark(plain));
        expect(compiled, "the two runs agree: todo.txt goes out").not.toEqual(plain);
        return;
      }
      expect(compiled).toEqual(plain);
      if (!existsSync(join(root, area, project, "under.txt"))) return;
      using checkedDir = tempDir("aot-test-run-in-folder", join(root, area, project));
      const words = readFileSync(join(root, area, project, "under.txt"), "utf8").trim();
      expect(await outcomeOf(String(checkedDir), words, "--aot", ...flags)).toEqual(plain);
    }, 180_000);
  }
}
