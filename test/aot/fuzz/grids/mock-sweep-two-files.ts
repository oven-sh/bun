// The projects of ../../harness/mock-sweep.ts of the kind "dual", in plain runs without `--aot`: "./lib" is lib.mjs for an import and lib.cjs for require().
// Each is held against the same project with one file for lib, statement by statement, in both orders of the steps.
// mock.module(), jest.mock() and jest.doMock() mock the name for both: what a statement prints is what it prints with lib.mjs alone or with lib.cjs alone.
// vi.mock() and vi.doMock() mock the file that an import loads: what is read through require() is lib.cjs itself, and the rest is what the project with lib.mjs prints.
// CI does not run it. After a change to module mocks: bun bd test ./test/aot/fuzz/grids/mock-sweep-two-files.ts
import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { mockSweep } from "../../harness/mock-sweep";
import { run } from "../../harness/run";

// When lib, its base and a factory run, and how often, differs between one file and two.
const leftOut = /^\| (?:base runs|lib runs|the folder's lib runs|factory (?:runs|begins|ends))$/;
// With one file too these print something else from run to run: the mock lands on the loaded modules when a timer fires or when the file in __mocks__ has been read.
const wavers = /-(?:timer|folder)-in-test-loaded$/;

// The statement that printed a line: the words in front of what it read.
const statement =
  /^(?:\| (?:(?:restored )?(?:static usern|import\(\)|require\(\))|second file(?: top| userc)?|user[nc]? runs|usern?\.mjs|userc|setup runs|top)|exit)(?= |$)/;
function statementOf(line: string) {
  const found = statement.exec(line);
  if (!found) throw new Error(`no statement of the projects prints this line: ${line}`);
  return found[0];
}

// What a statement that reads through require() prints where no mock answers for lib.cjs. userc.cjs then runs whenever the test requires it: its own line goes with that of the test.
const ofLibCjsItself: Partial<Record<string, string[]>> = {
  "| userc runs": [],
  "| userc": ["| userc runs real v", "| userc real v,real f,kept:base,obj:f+kept+v real v,kept:base"],
  "| require()": ["| require() obj:f+kept+v real v real f kept:base undefined"],
  "| restored require()": ["| restored require() obj:f+kept+v real v real f kept:base undefined"],
  "| second file userc": ["| second file userc real v,real f,kept:base,obj:f+kept+v"],
};
// z.test.mjs prints `v` of its import, `v` of require() and what usern.mjs reads in one line. The last begins with `v` of the import again.
const requiredInSecondFile = /^(\| second file (\w+ v|\S+)) (?:\w+ v|\S+) (?=\2,)/;

async function printed(files: Record<string, string>) {
  using dir = tempDir("mock-sweep-two-files", files);
  const { stdout, exitCode } = await run([bunExe(), "test", "."], String(dir));
  return [...stdout.split("\n").filter(line => line.startsWith("| ") && !leftOut.test(line)), `exit ${exitCode}`];
}

/** The statements whose lines in `project` are their lines in none of `rows`. For each: what it printed in `project`, then in each row. */
function differing(project: string[], rows: string[][]) {
  const all = [project, ...rows].map(lines => Map.groupBy(lines, statementOf));
  return [...new Set(all.flatMap(lines => [...lines.keys()]))]
    .map(statement => all.map(lines => (lines.get(statement) ?? []).join("\n")))
    .filter(([mine, ...theirs]) => !theirs.includes(mine));
}

async function isSeenAsWithOneFile(projects: Map<string, Record<string, string>>, name: string) {
  // One project after another: the tests of this file run beside one another.
  const ofKind = (kind: string) => printed(projects.get(name.replace("dual", kind))!);
  const dual = await ofKind("dual");
  const mjs = await ofKind("mjs");
  // A project that printed nothing would pass for the wrong reason.
  expect(dual.length).toBeGreaterThan(1);
  if (!name.startsWith("dual-vi-")) return expect(differing(dual, [mjs, await ofKind("cjs")])).toEqual([]);
  const withLibCjsItself = mjs.flatMap(
    line => ofLibCjsItself[statementOf(line)] ?? [line.replace(requiredInSecondFile, "$1 real v ")],
  );
  expect(differing(dual, [withLibCjsItself])).toEqual([]);
}

for (const requireFirst of [false, true]) {
  const projects = mockSweep(["mjs", "cjs", "dual"], requireFirst);
  const names = [...projects.keys()].filter(name => name.startsWith("dual-") && !wavers.test(name));
  const title = "a mock of two files is seen as a mock of one is" + (requireFirst ? ", require() first" : "");
  describe.concurrent(title, () => {
    test.each(names)("%s", name => isSeenAsWithOneFile(projects, name), 120_000);
  });
}
