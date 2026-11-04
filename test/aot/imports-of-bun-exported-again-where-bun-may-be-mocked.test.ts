// `import bun, { which } from "bun"` runs as `var bun = Bun, { which } = Bun`: it loads no module, so a mock of "bun" changes none of
// the names, and a file that exports them again exports variables of its own.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, normalizeBunSnapshot, tempDir } from "harness";
import { type CaseOfRun, sayOf } from "./harness/cases-of-one-run";
import { run } from "./harness/run";
import { test } from "./supported";

// A project is run once in each of these ways, and plain Bun says what the compiled runs have to print. With a word that begins
// with `TestRun` a compiled run says on stderr how it was built. `built`: what that line has to say of so many test files.
type Form = { title: string; flags: string[]; words?: string; built?: (testFiles: number) => RegExp };
const plainly: Form = { title: "plain bun test", flags: [] };
const asOneProgram: Form = {
  title: "bun test --aot as one program",
  flags: ["--aot"],
  words: "TestRunLayers:0",
  built: testFiles => new RegExp(`^AOT test run \\| one program\\b.* \\| test files ${testFiles}$`),
};
// Each test file is a program of its own. Where this Bun has layers, run() holds the run to the two that the words ask for.
const overTwoLayers: Form = {
  title: "bun test --aot over two layers",
  flags: ["--aot"],
  words: "TestRunLayers:2,TestRunPartFiles:1",
  built: testFiles => new RegExp(`^AOT test run \\| .+ \\| test files ${testFiles} \\| to a program 1\\b`),
};

type Run = {
  /** How the test of each case ended, and what the case printed through `say`. */
  cases: Map<string, CaseOfRun>;
  /** What no case answers for: the other lines of stdout and of stderr, without the times, and the exit code. */
  rest: { stdout: string[]; stderr: string[]; exitCode: number };
};

/** The cases of a project are the test files of one folder each, and the project is run once in each form. */
function project(name: string, where: string) {
  const files: Record<string, string> = { "package.json": `{ "name": "p", "type": "module" }` };
  const cases: string[] = [];
  const runs = new Map<Form, Promise<Run>>();
  // bun:test does not end the run of a concurrent test that reaches its time limit. The file ends when its runs have.
  afterAll(() => Promise.allSettled(runs.values()));

  /**
   * Adds a folder with a test file and what it imports. `testFile` gets the name of the case: its one test has that name, and what
   * it prints goes through `say`, which `sayOf(name)` declares. Every case is added before the first run.
   */
  function add(testFile: (name: string) => string, others: Record<string, string>) {
    if (runs.size) throw new Error("the project has run already");
    const id = `c${String(cases.length + 1).padStart(2, "0")}`;
    cases.push(id);
    files[`${id}/case.test.js`] = testFile(id);
    for (const [path, text] of Object.entries(others)) files[`${id}/${path}`] = text;
    return id;
  }

  /** `bun test --isolate` in a copy of the project, once in each form, for every test that reads the run. */
  const ran = (form: Form) =>
    runs.getOrInsertComputed(form, async () => {
      using folder = tempDir("imports-of-bun-exported-again-" + name, files);
      const env = form.words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: form.words } : bunEnv;
      const command = [bunExe(), "test", "--isolate", ...form.flags];
      const { stdout, stderr, exitCode } = await run(command, String(folder), env);
      // A line is a case's only where the project has a case of that name.
      const told: Run = {
        cases: new Map(cases.map(id => [id, { result: undefined, printed: "" }])),
        rest: { stdout: [], stderr: [], exitCode },
      };
      for (const line of stdout.split("\n")) {
        const [, id, text] = line.match(/^(c\d+)\| ?(.*)$/) ?? [];
        const of = told.cases.get(id);
        if (of) of.printed += text + "\n";
        else if (line.trim()) told.rest.stdout.push(normalizeBunSnapshot(line));
      }
      for (const line of stderr.split("\n")) {
        const [, result, id] = line.match(/^\((pass|fail)\) (c\d+)(?: \[.*\])?$/) ?? [];
        // A test file is named above the result of its test.
        const [, named] = line.match(/^(c\d+)[\\/]case\.test\.js:$/) ?? [];
        const of = told.cases.get(id);
        if (of) of.result = result;
        else if (line.trim() && !told.cases.has(named)) told.rest.stderr.push(normalizeBunSnapshot(line));
      }
      return told;
    });

  return { where, cases, add, ran };
}

// The cases of a project are compiled as one program, so "bun" may be mocked in all of them as soon as one of them says so.
// A file that takes bun:test whole may mock any module.
const besideAllOfBunTest = project("beside-all-of-bun-test", "beside all of bun:test");
const besideAMockOfBun = project("beside-a-mock-of-bun", "beside a mock of bun");

// Each run is a test of its own, so `bun test --max-concurrency` says how many of them are built at once: with two, the projects
// are built side by side in each form. The test of a case, further down, reads the runs that have ended here.
for (const form of [plainly, asOneProgram, overTwoLayers]) {
  for (const group of [besideAllOfBunTest, besideAMockOfBun]) {
    test.concurrent(`every case passes and nothing else is printed, ${group.where}: ${form.title}`, async () => {
      const count = group.cases.length;
      expect((await group.ran(form)).rest).toEqual({
        stdout: ["bun test <version> (<revision>)"],
        stderr: [
          ...(form.built ? [expect.stringMatching(form.built(count))] : []),
          `${count} pass`,
          "0 fail",
          `Ran ${count} tests across ${count} files.`,
        ],
        exitCode: 0,
      });
    });
  }
}

const what = `const what = value =>
  value === Bun ? "Bun" : value === Bun.which ? "Bun.which" : typeof value === "string" ? value : typeof value;`;
const source = `
  import bun, { which } from "bun";
  import * as all from "bun";
  export { bun, which, all };
  export const inside = () => [bun, which, all];`;
const mock = `mock.module("bun", () => ({ default: "mocked default", which: "mocked which" }));`;
const listed = "all Bun\nbun Bun\ninside function\nwhich Bun.which\n";

function runsAsPlain(
  group: ReturnType<typeof project>,
  title: string,
  expected: string,
  body: string,
  files: Record<string, string>,
) {
  const [start, end] =
    group === besideAllOfBunTest
      ? [`(await import("bun:test")).test(`, `);`]
      : [`import { mock, test } from "bun:test";\ntest(`, `);`];
  const name = group.add(name => `${sayOf(name)}\n${what}\n${start}"${name}", async () => {${body}}${end}`, files);
  test(title, async () => {
    const plain = (await group.ran(plainly)).cases.get(name);
    expect(plain).toEqual({ result: "pass", printed: expected });
    expect((await group.ran(asOneProgram)).cases.get(name)).toEqual(plain);
    expect((await group.ran(overTwoLayers)).cases.get(name)).toEqual(plain);
  });
}

const listsNamespace = (path: string) => `
  const namespace = await import("${path}");
  for (const key of Object.keys(namespace)) say(key, what(namespace[key]));`;

for (const group of [besideAllOfBunTest, besideAMockOfBun]) {
  const { where } = group;

  runsAsPlain(group, `the namespace object of the file is listed, ${where}`, listed, listsNamespace("./source.mjs"), {
    "source.mjs": source,
  });

  runsAsPlain(group, `the names come through export *, ${where}`, listed, listsNamespace("./front.mjs"), {
    "source.mjs": source,
    "front.mjs": `export * from "./source.mjs";`,
  });

  runsAsPlain(
    group,
    `Object.values() and Object.entries() of the namespace object, ${where}`,
    "Bun,Bun,function,Bun.which\nall:Bun,bun:Bun,inside:function,which:Bun.which\n",
    `
      const namespace = await import("./source.mjs");
      say(Object.values(namespace).map(what).join());
      say(Object.entries(namespace).map(([key, value]) => key + ":" + what(value)).join());`,
    { "source.mjs": source },
  );

  runsAsPlain(
    group,
    `require() of the file, ${where}`,
    "Bun Bun.which Bun\nBun Bun.which Bun\n",
    `
      const read = (await import("./reader.cjs")).default;
      say(...read.members.map(what));
      say(...read.taken.map(what));`,
    {
      "source.mjs": source,
      "reader.cjs": `
        const source = require("./source.mjs");
        const { bun, which, all } = source;
        module.exports = { members: [source.bun, source.which, source.all], taken: [bun, which, all] };`,
    },
  );

  runsAsPlain(
    group,
    `names, written members and what the file itself reads, ${where}`,
    "Bun Bun.which Bun\nBun Bun.which Bun\nBun Bun.which Bun\n",
    `
      const read = await import("./reader.mjs");
      say(...read.named.map(what));
      say(...read.written.map(what));
      say(...read.inside.map(what));`,
    {
      "source.mjs": source,
      "reader.mjs": `
        import * as source from "./source.mjs";
        import { bun, which, all } from "./source.mjs";
        export const named = [bun, which, all];
        export const written = [source.bun, source.which, source.all];
        export const inside = source.inside();`,
    },
  );

  runsAsPlain(
    group,
    `the default import under other names, ${where}`,
    "default Bun\nrenamed Bun\n",
    listsNamespace("./source.mjs"),
    { "source.mjs": `import bun from "bun";\nexport { bun as renamed, bun as default };` },
  );
}

runsAsPlain(besideAMockOfBun, "a mock made before the file is loaded", listed, mock + listsNamespace("./source.mjs"), {
  "source.mjs": source,
});

runsAsPlain(
  besideAMockOfBun,
  "a mock made behind the load",
  listed + listed + "Bun Bun.which Bun\n",
  `${listsNamespace("./source.mjs")}
    ${mock}
    for (const key of Object.keys(namespace)) say(key, what(namespace[key]));
    say(...namespace.inside().map(what));`,
  { "source.mjs": source },
);

runsAsPlain(
  besideAMockOfBun,
  "a mock that has neither name, and a file that exports neither",
  "Bun Bun.which\n",
  `
    mock.module("bun", () => ({ other: 1 }));
    say(...(await import("./source.mjs")).inside().map(what));`,
  { "source.mjs": `import bun, { which } from "bun";\nexport const inside = () => [bun, which];` },
);
