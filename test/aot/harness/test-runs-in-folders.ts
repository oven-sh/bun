// For test-runs-in-folders-*.test.ts. Each folder two levels below parallel-test-runs/ is a project with test files: parallel-test-runs/<area>/<what it shows>/. It is copied out of the tree and run twice, by
// `bun test` and by `bun test --aot`. What `bun test` prints is the specification: the lines that the tests print, how each test ends and the exit code must be equal.
// A project needs no expectation of its own. It prints what a wrong answer would change, or expects it in a test, which then fails in one run alone. A preload is named by a bunfig.toml in the folder.
// The test files of a project end in _test, which `bun test` finds: scripts/runner.node.ts takes every name that holds ".test" for a test of the repository.
// The packages of a project lie in a folder `installed`, which the copy has as `node_modules`: git ignores a folder of that name, and so does whatever carries this tree to another machine.
// A file flags.txt in the folder holds flags for both runs: `--isolate`.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { test } from "../supported";
import { run } from "./run";

const root = join(import.meta.dir, "..", "parallel-test-runs");
const foldersIn = (folder: string) =>
  readdirSync(folder, { withFileTypes: true })
    // git holds no empty folder: one that is left behind in a working tree is no project.
    .filter(entry => entry.isDirectory() && readdirSync(join(folder, entry.name)).length > 0)
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

function layPackages(folder: string) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const name = entry.name === "installed" ? "node_modules" : entry.name;
    if (name !== entry.name) renameSync(join(folder, entry.name), join(folder, name));
    layPackages(join(folder, name));
  }
}

async function outcomeOf(dir: string, ...flags: string[]) {
  layPackages(dir);
  // As users run it: whoever runs this file may have switched the thread off that reads the texts.
  const env = { ...bunEnv, NO_COLOR: "1", BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "0" };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, ...testFilesIn(dir)], dir, env);
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
      // A folder for each run: a build leaves files beside what it reads.
      using plainDir = tempDir("aot-test-run-in-folder", join(root, area, project));
      using compiledDir = tempDir("aot-test-run-in-folder", join(root, area, project));
      const flags = flagsOf(join(root, area, project));
      const [plain, compiled] = await Promise.all([
        outcomeOf(String(plainDir), ...flags),
        outcomeOf(String(compiledDir), "--aot", ...flags),
      ]);
      // A run in which plain says nothing would pass for the wrong reason: it prints, or a test of it passes by what it expects.
      expect(plain.printed.length + plain.tests.filter(line => line.startsWith("(pass) ")).length).toBeGreaterThan(0);
      expect(plain.tests.length).toBeGreaterThan(0);
      expect(compiled).toEqual(plain);
    }, 180_000);
  }
}
