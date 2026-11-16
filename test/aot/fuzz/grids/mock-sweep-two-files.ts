// The projects of ../../harness/mock-sweep.ts of the kind "dual", in plain runs without `--aot`: "./lib" is lib.mjs for an import and lib.cjs for require().
// Each is held against the same project with one file for lib, statement by statement, in both orders of the steps.
// mock.module(), jest.mock() and jest.doMock() mock the name for both: what a statement prints is what it prints with lib.mjs alone or with lib.cjs alone.
// Not so, on purpose, in dual-jest-mock-folder-in-test-loaded and dual-jest-doMock-folder-in-test-loaded: with two files the file in __mocks__ loads at the call. See ofLibCjsInFolder.
// vi.mock() and vi.doMock() mock the file that an import loads: what is read through require() is lib.cjs itself, and the rest is what the project with lib.mjs prints.
// CI does not run it. After a change to module mocks: bun bd test ./test/aot/fuzz/grids/mock-sweep-two-files.ts
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { mockSweep } from "../../harness/mock-sweep";
import { run } from "../../harness/run";

// When lib, its base and a factory run, and how often, differs between one file and two.
const leftOut = /^\| (?:base runs|lib runs|the folder's lib runs|factory (?:runs|begins|ends))$/;
// A mock that lands on the loaded modules behind its call, when a timer fires or when the file in __mocks__ has been read, races with the test while a second thread transpiles:
// the project prints something else from run to run, with one file too. On one thread it prints one output. vi.doMock() leaves the loaded modules as they are: its projects do not waver.
const wavers = /^dual-(?!vi-doMock-).+-(?:timer|folder)-in-test-loaded$/;
const oneThread = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };

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

// jest.mock() and jest.doMock() without a factory, called in a test where lib is loaded: with one file the mock lands when the file in __mocks__ has been read,
// with two that file loads at the call. So each statement behind the call prints the mock that has landed, made of the file that require() loads.
// These are the statements that come too early for it with one file, in one order of the steps or in both.
const loadsFolderAtTheCall = /^dual-jest-(?:mock|doMock)-folder-in-test-loaded$/;
const ofLibCjsInFolder = [
  "| static usern folder v,folder f,folder kept,obj:f+kept+v,obj:default+f+kept+v",
  "| usern.mjs folder v,folder f,folder kept,obj:f+kept+v,obj:default+f+kept+v",
  "| require() obj:f+kept+v folder v folder f folder kept undefined",
  "| userc runs folder v",
  "| userc folder v,folder f,folder kept,obj:f+kept+v folder v,folder kept",
];
const tooEarlyWithOneFile = new Set(ofLibCjsInFolder.map(statementOf));

async function printed(files: Record<string, string>, env: typeof bunEnv) {
  using dir = tempDir("mock-sweep-two-files", files);
  // Far above what a test of a project takes under load. One that runs into its limit ends its file and the mocks with it: the statements behind it then read the real file.
  const { stdout, exitCode } = await run([bunExe(), "test", "--timeout=60000", "."], String(dir), env);
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
  const env = wavers.test(name) ? oneThread : bunEnv;
  // One project after another: the tests of this file run beside one another.
  const ofKind = (kind: string) => printed(projects.get(name.replace("dual", kind))!, env);
  const dual = await ofKind("dual");
  const mjs = await ofKind("mjs");
  // A project that printed nothing would pass for the wrong reason.
  expect(dual.length).toBeGreaterThan(1);
  if (!name.startsWith("dual-vi-")) {
    const rows = [mjs, await ofKind("cjs")];
    if (!loadsFolderAtTheCall.test(name)) return expect(differing(dual, rows)).toEqual([]);
    const withMockLanded = rows.map(row => [
      ...row.filter(line => !tooEarlyWithOneFile.has(statementOf(line))),
      ...ofLibCjsInFolder,
    ]);
    return expect(differing(dual, withMockLanded)).toEqual([]);
  }
  const withLibCjsItself = mjs.flatMap(
    line => ofLibCjsItself[statementOf(line)] ?? [line.replace(requiredInSecondFile, "$1 real v ")],
  );
  expect(differing(dual, [withLibCjsItself])).toEqual([]);
}

for (const requireFirst of [false, true]) {
  const projects = mockSweep(["mjs", "cjs", "dual"], requireFirst);
  const names = [...projects.keys()].filter(name => name.startsWith("dual-"));
  const title = "a mock of two files is seen as a mock of one is" + (requireFirst ? ", require() first" : "");
  describe.concurrent(title, () => {
    test.each(names)("%s", name => isSeenAsWithOneFile(projects, name), 300_000);
  });
}
