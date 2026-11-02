import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, normalizeBunSnapshot, tempDir } from "harness";
import { atLeastWhatTheRunnerGave } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// `const { mock } = require("bun:test"); mock.module("made-up", () => ({ v: "mocked" }))`, where no package and no file has the name.
// The build listed the names that only a mock answers for from the calls of `mock.module` whose `mock` an import statement names. Any other way to `mock` left the
// name off the list, and whoever imported it was told at run time that the build had not found it.
//
// One file that mocks out of sight opens the whole run: the build then leaves every name that it does not find to the loader. A run for each way compiles Bun's own
// code once for each, so all the ways lie in one project, which is built once in each form. Two things keep them apart there. Each way has a preload, a name and
// readers of its own: a name is found only where the preload of its way has mocked it. And the other preloads would hide a way that the build no longer sees, so
// the scan in front of the build is read as well: it says of each file by itself whether it mocks a module that it does not spell.
const ways: [how: string, way: string, preload: string, text: (mocked: string) => string][] = [
  [
    "a pattern takes it from require()",
    "pattern",
    "preload-pattern.cjs",
    mocked => `const { mock } = require("bun:test");\nmock.module${mocked}`,
  ],
  ["it is a member of require()", "member", "preload-member.cjs", mocked => `require("bun:test").mock.module${mocked}`],
  [
    "a name holds what require() answered",
    "name",
    "preload-name.cjs",
    mocked => `const runner = require("bun:test");\nrunner.mock.module${mocked}`,
  ],
  [
    "an ES module calls require()",
    "es-module",
    "preload-es-module.ts",
    mocked => `const { mock } = require("bun:test");\nmock.module${mocked}`,
  ],
  [
    "jest.mock() of require()",
    "jest",
    "preload-jest.cjs",
    mocked => `const { jest } = require("bun:test");\njest.mock${mocked}`,
  ],
  [
    "it is a member of the namespace",
    "namespace",
    "preload-namespace.ts",
    mocked => `import * as runner from "bun:test";\nrunner.mock.module${mocked}`,
  ],
  [
    "a function is handed it",
    "handed",
    "preload-handed.ts",
    mocked =>
      `import { mock } from "bun:test";\nfunction fake(handed: typeof mock) { handed.module${mocked} }\nfake(mock);`,
  ],
];

// Every file lies in the one folder. `bun test` runs the test files of the folder that it starts in in the order of their names, and those of a folder below in
// the order in which the disk lists them. So on every disk the lazy readers of a way ask for its name before its readers do, as in a project with one way.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "bunfig.toml": `[test]\npreload = [${ways.map(([, , preload]) => `"./${preload}"`).join(", ")}]\n`,
  "nobody.test.ts": `import { test } from "bun:test";
const here = import.meta.dirname;
const say = (how: string, error: any) => console.log("SEEN nobody mocks it,", how, error.name, error.code, String(error.message).replaceAll(here, "<here>").split(" imported from ")[0]);
test("names that nobody mocks", async () => {
  try { require("nobody-has-it"); } catch (error) { say("require():", error); }
  try { await import("nobody-has-it"); } catch (error) { say("import():", error); }
  try { require("./no-such-file.js"); } catch (error) { say("a path:", error); }
  // The error names what the program asked for, which the build spells "./no-such-file.js".
  try { require(here + "/no-such-file.js"); } catch (error) { say("require() of a whole path:", error); }
  try { require.resolve(here + "/no-such-file.js"); } catch (error) { say("require.resolve() of a whole path:", error); }
});
`,
  "nobody-imported.test.ts": `import { test } from "bun:test";
import { v } from "nobody-has-it-either";
test("never runs", () => console.log("SEEN", v));
`,
};
for (const [, way, preload, text] of ways) {
  const name = `made-up-${way}`;
  files[preload] = text(`("${name}", () => ({ v: "mocked by ${way}" }));`);
  files[`readers-${way}.test.ts`] = `import { test } from "bun:test";
import { v } from "${name}";
test("three ways to read the mock", async () => {
  console.log("SEEN ${way} | the mock:", v, "|", require("${name}").v, "|", (await import("${name}")).v);
});
`;
  // Over layers these two lie in a program below the test files.
  files[`lazy-${way}.cjs`] = `exports.read = function () { return require("${name}").v; };`;
  files[`lazy-import-${way}.ts`] = `export async function read() { return (await import("${name}")).v; }`;
  files[`lazy-readers-${way}.test.ts`] = `import { test } from "bun:test";
import { read as readByRequire } from "./lazy-${way}.cjs";
import { read as readByImport } from "./lazy-import-${way}.ts";
test("files that test files import read the mock when they are called", async () => {
  console.log("SEEN ${way} | the mock, from the files that test files import:", readByRequire(), "|", await readByImport());
});
`;
}

const forms = { "as one program": "TestRunLayers:0", "over two layers": "TestRunLayers:2,TestRunPartFiles:1" };

type Told = {
  stdout: string;
  stderr: string;
  exitCode: number;
  /** What the runner says on stderr, without the times: each test file, how its tests ended, what it could not load, and the counts. */
  report: string[];
  /** Of a compiled run: the files of which the scan in front of the build says that they mock a module that they do not spell. */
  mocksOutOfSight: string[];
  /** Of a compiled run: how it was built. */
  form: string | undefined;
};

// A compiled run writes its log and the warnings of its builds between these lines.
const isOfReport =
  /^(?:.+\.test\.ts:|\((?:pass|fail|skip|todo)\) .*|error: .*|# Unhandled error between tests| *\d+ (?:pass|fail|skip|todo|errors?|expect\(\) calls)|Ran \d+ tests? across \d+ files?\..*)$/;

let project: ReturnType<typeof tempDir> | undefined;
const runs = new Map<string, Promise<Told>>();
afterAll(async () => {
  await Promise.allSettled(runs.values());
  project?.[Symbol.dispose]();
});

/** `bun test` in the project, or `bun test --aot` in the form that the words ask for: once, for all the tests that read it. */
function ran(words?: string): Promise<Told> {
  return runs.getOrInsertComputed(words ?? "", async () => {
    project ??= tempDir("aot-a-module-that-exists-only-as-a-mock", files);
    const dir = String(project);
    // The scan says what it finds in a file only with the log of the phases.
    const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" } : bunEnv;
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...(words ? ["--aot"] : [])], dir, env);
    const lines = stderr.replaceAll(dir, "<dir>").replaceAll("\\", "/").split("\n");
    // One file of the project fails in every run. A run that ends otherwise says why at its end.
    if (exitCode !== 1) console.error(lines.slice(-40).join("\n"));
    // What the scan of the test files and the preloads finds is what the builds are told. It names a file by its whole path. The scan that a build makes of its
    // own entry points names a preload as bunfig.toml does, and nobody asks it about mocks.
    const mocking = /^AOT test run \| <dir>\/(.+) mocks a module that it does not spell$/;
    return {
      stdout,
      stderr,
      exitCode,
      report: lines.filter(line => isOfReport.test(line)).map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
      mocksOutOfSight: [...new Set(lines.flatMap(line => mocking.exec(line)?.[1] ?? []))].sort(),
      form: /^AOT test run \| ((?:one program|layers|programs without layers)\b.*)$/m.exec(stderr)?.[1],
    };
  });
}

/** What a run says of one way: what its two test files printed, and how their tests ended. */
function ofWay(told: Told, way: string) {
  const testsOf = (file: string) => {
    const header = told.report.indexOf(`${file}:`);
    // Up to the next test file, or to the counts.
    const behind = told.report.findIndex((line, index) => index > header && !/^(?:\(|error: |# )/.test(line));
    return header < 0 ? undefined : told.report.slice(header + 1, behind < 0 ? undefined : behind);
  };
  return {
    printed: told.stdout.split("\n").filter(line => line.startsWith(`SEEN ${way} | `)),
    "the lazy readers": testsOf(`lazy-readers-${way}.test.ts`),
    "the readers": testsOf(`readers-${way}.test.ts`),
  };
}

// A test waits for the runs that it reads, unless a test before it has: for one build at the most. A debug build of Bun has taken over four minutes for the
// one in layers.
const limit = isDebug ? 600_000 : atLeastWhatTheRunnerGave(180_000, isASAN);

test(
  "plain bun test finds each mock, and fails the file that imports what nobody mocks",
  async () => {
    const plain = await ran();
    expect(normalizeBunSnapshot(plain.stdout, String(project))).toMatchInlineSnapshot(`
      "bun test <version> (<revision>)
      SEEN es-module | the mock, from the files that test files import: mocked by es-module | mocked by es-module
      SEEN handed | the mock, from the files that test files import: mocked by handed | mocked by handed
      SEEN jest | the mock, from the files that test files import: mocked by jest | mocked by jest
      SEEN member | the mock, from the files that test files import: mocked by member | mocked by member
      SEEN name | the mock, from the files that test files import: mocked by name | mocked by name
      SEEN namespace | the mock, from the files that test files import: mocked by namespace | mocked by namespace
      SEEN pattern | the mock, from the files that test files import: mocked by pattern | mocked by pattern
      SEEN nobody mocks it, require(): ResolveMessage MODULE_NOT_FOUND Cannot find module 'nobody-has-it'
      Require stack:
      - <here>/nobody.test.ts
      SEEN nobody mocks it, import(): ResolveMessage ERR_MODULE_NOT_FOUND Cannot find package 'nobody-has-it'
      SEEN nobody mocks it, a path: ResolveMessage MODULE_NOT_FOUND Cannot find module './no-such-file.js'
      Require stack:
      - <here>/nobody.test.ts
      SEEN nobody mocks it, require() of a whole path: ResolveMessage MODULE_NOT_FOUND Cannot find module '<here>/no-such-file.js'
      Require stack:
      - <here>/nobody.test.ts
      SEEN nobody mocks it, require.resolve() of a whole path: ResolveMessage MODULE_NOT_FOUND Cannot find module '<here>/no-such-file.js'
      Require stack:
      - <here>/nobody.test.ts
      SEEN es-module | the mock: mocked by es-module | mocked by es-module | mocked by es-module
      SEEN handed | the mock: mocked by handed | mocked by handed | mocked by handed
      SEEN jest | the mock: mocked by jest | mocked by jest | mocked by jest
      SEEN member | the mock: mocked by member | mocked by member | mocked by member
      SEEN name | the mock: mocked by name | mocked by name | mocked by name
      SEEN namespace | the mock: mocked by namespace | mocked by namespace | mocked by namespace
      SEEN pattern | the mock: mocked by pattern | mocked by pattern | mocked by pattern"
    `);
    expect(normalizeBunSnapshot(plain.stderr, String(project))).toMatchInlineSnapshot(`
      "lazy-readers-es-module.test.ts:
      (pass) files that test files import read the mock when they are called

      lazy-readers-handed.test.ts:
      (pass) files that test files import read the mock when they are called

      lazy-readers-jest.test.ts:
      (pass) files that test files import read the mock when they are called

      lazy-readers-member.test.ts:
      (pass) files that test files import read the mock when they are called

      lazy-readers-name.test.ts:
      (pass) files that test files import read the mock when they are called

      lazy-readers-namespace.test.ts:
      (pass) files that test files import read the mock when they are called

      lazy-readers-pattern.test.ts:
      (pass) files that test files import read the mock when they are called

      nobody-imported.test.ts:

      # Unhandled error between tests
      -------------------------------
      error: Cannot find package 'nobody-has-it-either' from '<dir>/nobody-imported.test.ts'
      -------------------------------


      nobody.test.ts:
      (pass) names that nobody mocks

      readers-es-module.test.ts:
      (pass) three ways to read the mock

      readers-handed.test.ts:
      (pass) three ways to read the mock

      readers-jest.test.ts:
      (pass) three ways to read the mock

      readers-member.test.ts:
      (pass) three ways to read the mock

      readers-name.test.ts:
      (pass) three ways to read the mock

      readers-namespace.test.ts:
      (pass) three ways to read the mock

      readers-pattern.test.ts:
      (pass) three ways to read the mock

       15 pass
       1 fail
       1 error
      Ran 16 tests across 16 files."
    `);
    expect(plain.exitCode).toBe(1);
  },
  limit,
);

for (const [form, words] of Object.entries(forms)) {
  for (const [how, way, preload] of ways) {
    test(
      `a module that exists only as a mock is found: ${how}, ${form}`,
      async () => {
        const [plain, compiled] = [await ran(), await ran(words)];
        const found = {
          printed: [
            `SEEN ${way} | the mock, from the files that test files import: mocked by ${way} | mocked by ${way}`,
            `SEEN ${way} | the mock: mocked by ${way} | mocked by ${way} | mocked by ${way}`,
          ],
          "the lazy readers": ["(pass) files that test files import read the mock when they are called"],
          "the readers": ["(pass) three ways to read the mock"],
        };
        expect(ofWay(plain, way)).toEqual(found);
        expect({
          ...ofWay(compiled, way),
          "mocks out of sight, says the scan": compiled.mocksOutOfSight.filter(file => file === preload),
        }).toEqual({ ...found, "mocks out of sight, says the scan": [preload] });
      },
      limit,
    );
  }

  test(
    `a run with every way prints and ends as the plain run, ${form}`,
    async () => {
      const [plain, compiled] = [await ran(), await ran(words)];
      // Where the Bun under test loads one program a realm there are no layers to ask for: run() of the harness has looked.
      const hasLayers = form === "over two layers" && !compiled.form?.includes("this Bun loads one program a realm");
      expect({
        form: compiled.form,
        mocksOutOfSight: compiled.mocksOutOfSight,
        stdout: compiled.stdout,
        report: compiled.report,
        exitCode: compiled.exitCode,
      }).toEqual({
        form: expect.stringMatching(
          hasLayers
            ? /^layers 2 \| test files 16 \| to a program 1\b/
            : /^(?:one program|programs without layers)\b.* \| test files 16\b/,
        ),
        // No other file of the project opens the run.
        mocksOutOfSight: ways.map(([, , preload]) => preload).sort(),
        stdout: plain.stdout,
        report: plain.report,
        exitCode: 1,
      });
    },
    limit,
  );
}
