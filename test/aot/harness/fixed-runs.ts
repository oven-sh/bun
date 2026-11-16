// Faults of `bun test --aot` that are fixed, each as a small project: ../fixed-runs/<project>/<case>.txt. All the cases of a folder are laid as ONE project, a folder each,
// whose test files share a realm and are named in order on the command line. It runs twice: plain, which is the specification, and compiled.
// A run costs the same whatever it holds, so a case here costs a tenth of a second of processor time where a project of its own costs forty.
//
// A CASE is a text file, so that no runner takes its test files for tests of this repository, no formatter rewrites them and its node_modules are kept:
//   the first lines say what it is about; a line `preload: <path>` makes that file of the case a preload of the whole project;
//   a line `#### <path>` begins a file. Every line that the case prints begins with `| CASE`, which stands for the name of the case.
// What is held to plain: those lines, on either stream, which tests passed and failed under its test files, and the errors there.
//
// THE COMPANY HIDES FAULTS, its own and those of the others: what a build finds in one program holds for the whole program. So the folders go by what their cases let a
// build assume:
//   closed     every module is named by a written text, nothing loads again: no computed name, no plugin, no text run as code, no reset of the modules
//   few        closed, and kept small: cases that fall silent in any larger company. Nothing is added here
//   open       the rest
//   isolated   closed, under --isolate: each test file has a realm of its own
//   isolated-open   the rest under --isolate
//   rerun      under --rerun-each=3: each test file is loaded three times in one realm, and closed
//   rerun-open   under --rerun-each=3, the rest
//   evicted-data   data files whose keys a test file deletes from require.cache, and nothing else that opens the world: these cases fall silent in open
// A folder's project.json may say `flags`, which every run of it gets, `ways`: a name and the testing words for each compiled run, and `closed`: then the build's own
// report is held to it: no file of the run can run code that no build has seen, no mock, hand-on or spy may reach any module. One case that opens the world would silence the rest.
// Each folder has a test file of its own, ../fixed-runs-<project>.test.ts: CI's runner ends a test file after three minutes, six with a sanitizer.
// A case goes in only if it FAILS HERE, beside the others, on a Bun from before its fix, and every other case still fails on a Bun from before its own.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "../supported";
import { afterAll, raiseDefaultTimeout } from "./default-timeout";
import { run } from "./run";

export const folder = join(import.meta.dir, "..", "fixed-runs");
const usualWays: Record<string, string> = { "one program": "TestRunSaysItsForm" };

function read(project: string) {
  const settings = join(folder, project, "project.json");
  const {
    flags = [],
    ways = usualWays,
    closed = false,
  }: { flags?: string[]; ways?: Record<string, string>; closed?: boolean } = existsSync(settings)
    ? JSON.parse(readFileSync(settings, "utf8"))
    : {};
  const files: Record<string, string> = { "package.json": `{ "name": "runs", "type": "module" }\n` };
  const preloads: string[] = [];
  const cases = readdirSync(join(folder, project))
    .filter(name => name.endsWith(".txt"))
    .map(name => name.slice(0, -".txt".length))
    .sort();
  for (const name of cases) {
    const text = readFileSync(join(folder, project, name + ".txt"), "utf8").replaceAll("\r\n", "\n");
    const [head, ...parts] = text.split(/^#### /m);
    for (const [, path] of head.matchAll(/^preload: (\S+)$/gm)) preloads.push(`./${name}/${path}`);
    for (const part of parts) {
      const end = part.indexOf("\n");
      files[`${name}/${part.slice(0, end)}`] = part.slice(end + 1).replaceAll("| CASE", `| ${name}`);
    }
  }
  if (preloads.length > 0) files["bunfig.toml"] = `[test]\npreload = ${JSON.stringify(preloads)}\n`;
  return { cases, files, flags, ways, closed };
}

const whatTheBuildFound = "";

/** By case: the lines that it printed, on either stream, and what the runner said under its test files. */
async function ran(project: string, cases: string[], files: Record<string, string>, flags: string[], words?: string) {
  // A folder is listed in the order that its file system gives, and what one test file leaves to the next is what many a case is about.
  const testFiles = Object.keys(files)
    .filter(path => /\.test\.\w+$/.test(path) && !path.includes("/node_modules/"))
    .sort()
    .map(path => `./${path}`);
  using dir = tempDir(`aot-fixed-runs-${project}`, files);
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" } : bunEnv;
  const { stdout, stderr } = await run([bunExe(), "test", ...flags, ...testFiles], String(dir), env);
  const said = new Map<string, string[]>(cases.map(name => [name, []]));
  const found = stderr.match(/\d+ can run code that no build has seen|mocks any module \w+ .*$/gm) ?? [];
  said.set(whatTheBuildFound, [...new Set(found)]);
  const printed = /^\| (\S+) (.*)$/;
  for (const line of stdout.split(/\r?\n/)) {
    const [, name, words] = line.match(printed) ?? [];
    said.get(name)?.push(words);
  }
  let under: string[] | undefined;
  for (const line of stderr.split(/\r?\n/)) {
    const [, name, words] = line.match(printed) ?? [];
    const [, below] = line.match(/^([^\s\\/]+)[\\/]\S*\.test\.\w+:$/) ?? [];
    const [, result] = line.match(/^(\((?:pass|fail)\) .*?)(?: \[[\d.]+ms\])?$/) ?? [];
    if (name) said.get(name)?.push(words);
    else if (below) under = said.get(below);
    // The runner lists the failed tests once more at the end.
    else if (/^\d+ tests? failed:$/.test(line)) under = undefined;
    else if (result) under?.push(result);
    else if (/^(error|\w*Error): /.test(line)) under?.push(line.replace(/\S*[\\/]/g, ""));
  }
  return said;
}

/** Declares a test for each case of the project, in each of its ways. */
export function holdToPlain(project: string) {
  raiseDefaultTimeout(240_000);
  const { cases, files, flags, ways, closed } = read(project);
  const runs = new Map<string, ReturnType<typeof ran>>();
  const runOf = (way: string) =>
    runs.getOrInsertComputed(way, () =>
      way === "plain" ? ran(project, cases, files, flags) : ran(project, cases, files, ["--aot", ...flags], ways[way]),
    );
  afterAll(() => Promise.allSettled(runs.values()));

  if (closed)
    test("no case opens the world for the others", async () => {
      expect((await runOf(Object.keys(ways)[0])).get(whatTheBuildFound)).toEqual([
        "0 can run code that no build has seen",
        "mocks any module false | hands on any module false | spies on objects from somewhere false",
      ]);
    });

  describe.each(Object.keys(ways))("%s", way => {
    test.each(cases)("%s", async name => {
      const [plain, compiled] = await Promise.all([runOf("plain"), runOf(way)]);
      const expected = plain.get(name)!;
      expect(expected).not.toEqual([]);
      expect(expected.filter(line => line.startsWith("(fail)"))).toEqual([]);
      expect(compiled.get(name)).toEqual(expected);
    });
  });
}
