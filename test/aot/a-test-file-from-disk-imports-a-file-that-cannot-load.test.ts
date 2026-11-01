// BUN_AOT_TEST_FILES_FROM_DISK=1: the test files are not compiled, and import compiled files.
// src/odd.js is well formed, and what it imports or hands on is not there or is no program. Under `bun test` the load of the test
// file fails with what is wrong below: before a name that it imports is looked for, and before a file that it imports runs.
// Each case is a folder of one project: a build costs as much for one case as for all of them.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
import { beforeAll, test } from "./supported";

const words: Record<string, Record<string, string>> = {
  "the test files from disk": { BUN_AOT_TEST_FILES_FROM_DISK: "1" },
  "the test files from disk, and a file that imports what they name": {
    BUN_AOT_TEST_FILES_FROM_DISK: "1",
    BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
  },
};

const suite = (folder: string) => ({
  "src/good.js": `export const good = () => "good";\n`,
  "src/prints.js": `console.log("${folder}: a file beside the one that cannot load has run");\n`,
  "tests/healthy.test.js": `import { expect, test } from "bun:test";
import { good } from "../src/good.js";
test("a healthy file", () => {
  expect(good()).toBe("good");
});
`,
  "tests/takes-a-name.test.js": `import { expect, test } from "bun:test";
import "../src/prints.js";
import { through } from "../src/odd.js";
test("a name of a file that cannot load", () => {
  expect(through).toBe(1);
});
`,
  "tests/asks-twice.test.js": `import { expect, test } from "bun:test";
const ask = () => import("../src/odd.js").then(() => "loaded", error => error);
test("the load is caught twice", async () => {
  const [first, second] = [await ask(), await ask()];
  console.error("CAUGHT", String(first?.message ?? first), "|", String(second?.message ?? second), "|", first === second);
});
`,
});

/**
 * What is wrong below src/odd.js: what `bun test` prints of it for the test file that cannot load, and the message that
 * `import()` rejects with.
 */
type Wrong = (folder: string) => { printed: string; message: string };

const syntaxError: Wrong = folder => ({
  printed: `1 | export const a = ;\n                     ^\nerror: Unexpected ;\n    at ${folder}/src/broken.js:1:18`,
  message: "Unexpected ;",
});
const noSuchFile: Wrong = folder => ({
  printed: `error: Cannot find module './nowhere.js' from '${folder}/src/odd.js'`,
  message: `Cannot find module './nowhere.js' imported from ${folder}/src/odd.js`,
});
const noSuchModuleOfNode: Wrong = () => ({
  printed: "error: No such built-in module: node:there-is-no-such-module",
  message: "No such built-in module: node:there-is-no-such-module",
});

const brokenFile = { "src/broken.js": `export const a = ;\n` };

const cannotLoad: Record<string, { wrong: Wrong; files: Record<string, string> }> = {
  "hands on a name of a file with a syntax error": {
    wrong: syntaxError,
    files: { "src/odd.js": `export { a as through } from "./broken.js";\n`, ...brokenFile },
  },
  "hands on the default export of a file with a syntax error": {
    wrong: syntaxError,
    files: { "src/odd.js": `export { default as through } from "./broken.js";\n`, ...brokenFile },
  },
  "hands on every name of a file with a syntax error": {
    wrong: syntaxError,
    files: { "src/odd.js": `export * from "./broken.js";\n`, ...brokenFile },
  },
  "imports a name of a file with a syntax error and exports it": {
    wrong: syntaxError,
    files: { "src/odd.js": `import { a } from "./broken.js";\nexport { a as through };\n`, ...brokenFile },
  },
  "hands on a name that the next file hands on from a file with a syntax error": {
    wrong: syntaxError,
    files: {
      "src/odd.js": `export { through } from "./between.js";\n`,
      "src/between.js": `export { a as through } from "./broken.js";\n`,
      ...brokenFile,
    },
  },
  "hands on a name of a file that is not there": {
    wrong: noSuchFile,
    files: { "src/odd.js": `export { through } from "./nowhere.js";\n` },
  },
  "hands on every name of a file that is not there": {
    wrong: noSuchFile,
    files: { "src/odd.js": `export * from "./nowhere.js";\n` },
  },
  "hands on a file that is not there as an object": {
    wrong: noSuchFile,
    files: { "src/odd.js": `export * as through from "./nowhere.js";\n` },
  },
  "hands on a name of a module of Node that does not exist": {
    wrong: noSuchModuleOfNode,
    files: { "src/odd.js": `export { through } from "node:there-is-no-such-module";\n` },
  },
  "exports the name itself and imports a file that is not there": {
    wrong: noSuchFile,
    files: { "src/odd.js": `import "./nowhere.js";\nexport const through = 1;\n` },
  },
  "lacks the name and imports a file that is not there": {
    wrong: noSuchFile,
    files: { "src/odd.js": `import "./nowhere.js";\nexport const other = 1;\n` },
  },
};

const folderOf = (name: string) => `c${String(Object.keys(cannotLoad).indexOf(name)).padStart(2, "0")}`;

const project = {
  "package.json": `{ "name": "suite", "type": "module" }`,
  ...Object.fromEntries(
    Object.entries(cannotLoad).map(([name, { files }]) => [folderOf(name), { ...suite(folderOf(name)), ...files }]),
  ),
};

/** What the test files of one folder printed, the errors between tests by test file, and what the files beside them printed. */
type Case = { errors: Record<string, string[]>; caught: string[]; ends: string[]; printed: string[] };

async function runTests(directory: string, env: Record<string, string>, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, {
    ...bunEnv,
    ...env,
  });
  // A test file of every folder fails, so the run ends with 1. What else has ended it says so on stderr alone.
  if (exitCode !== 1) console.error(stderr);
  const cases: Record<string, Case> = {};
  const of = (folder: string) => (cases[folder] ??= { errors: {}, caught: [], ends: [], printed: [] });
  const withoutDirectory = stderr.replaceAll("\\", "/").replace(/[^\s'"]*\/(c\d+\/(?:src|tests)\/)/g, "$1");
  // What a test file prints follows a line with its path. What the run prints at its end begins with the failed files, if it
  // lists them, and with the counts if not.
  const end = withoutDirectory.search(/^(?:\d+ tests failed:| *\d+ pass)$/m);
  const [underPaths, atEnd] =
    end < 0 ? [withoutDirectory, ""] : [withoutDirectory.slice(0, end), withoutDirectory.slice(end)];
  const [, ...parts] = underPaths.split(/^(c\d+)\/tests\/(\S+):$/m);
  for (let index = 0; index < parts.length; index += 3) {
    const [folder, file, text] = [of(parts[index]), parts[index + 1], parts[index + 2]];
    const errors = [...text.matchAll(/^-{31}\n([^]*?)\n-{31}$/gm)].map(match => match[1]);
    if (errors.length) (folder.errors[file] ??= []).push(...errors);
    folder.caught.push(...(text.match(/^CAUGHT .*$/gm) ?? []));
    for (const [, result, title] of text.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm))
      folder.ends.push(`${result} ${title}`);
  }
  for (const line of stdout.split("\n")) {
    const folder = line.match(/^(c\d+): /)?.[1];
    if (folder) of(folder).printed.push(line);
  }
  for (const folder of Object.values(cases)) folder.ends.sort();
  return {
    cases,
    whole: {
      failed: [...atEnd.matchAll(/^\(fail\) (.*)$/gm)].map(match => match[1]).sort(),
      counts: [...atEnd.matchAll(/^ *(\d+ (?:pass|fail|errors?|expect\(\) calls))$/gm)].map(match => match[1]),
      ran: atEnd.match(/^Ran \d+ tests across \d+ files/m)?.[0],
      stdout: stdout.replace(/^bun test .*\n/, ""),
      exitCode,
    },
  };
}

// `bun test --isolate <flags>` in the one project, once for each way of running it. The runs start together and end in the hook:
// a case only compares, and a run that fails fails the cases that read it. Side by side the two builds take a debug build of Bun
// 4 to 9 minutes, and supported.ts gives a hook 270 s there.
const ways: Record<string, [env: Record<string, string>, ...flags: string[]]> = {
  "bun test": [{}],
  ...Object.fromEntries(Object.entries(words).map(([form, env]) => [form, [env, "--aot"]])),
};
const runs = new Map<string, ReturnType<typeof runTests>>();
let dir: ReturnType<typeof tempDir> | undefined;
beforeAll(
  async () => {
    dir = tempDir("aot-a-test-file-from-disk-imports-a-file-that-cannot-load", project);
    for (const [way, [env, ...flags]] of Object.entries(ways)) runs.set(way, runTests(String(dir), env, ...flags));
    await Promise.allSettled(runs.values());
  },
  isDebug ? 900_000 : undefined,
);
afterAll(() => dir?.[Symbol.dispose]());

for (const form of Object.keys(words)) {
  test.concurrent.each(Object.keys(cannotLoad))(`${form}: a file that %s`, async name => {
    const folder = folderOf(name);
    const wrong = cannotLoad[name].wrong(folder);
    const plain = (await runs.get("bun test")!).cases[folder];
    expect(plain).toEqual({
      errors: { "takes-a-name.test.js": [wrong.printed] },
      caught: [`CAUGHT ${wrong.message} | ${wrong.message} | true`],
      ends: ["pass a healthy file", "pass the load is caught twice"],
      printed: [],
    });
    expect((await runs.get(form)!).cases[folder]).toEqual(plain);
  });

  test.concurrent(`${form}: the run of all the cases ends as under bun test`, async () => {
    const count = Object.keys(cannotLoad).length;
    const plain = (await runs.get("bun test")!).whole;
    expect(plain).toEqual({
      // `bun test` lists the files that failed at its end where more than 20 tests pass.
      failed: Object.keys(cannotLoad).map(name => `${folderOf(name)}/tests/takes-a-name.test.js`),
      counts: [`${2 * count} pass`, `${count} fail`, `${count} errors`, `${count} expect() calls`],
      ran: `Ran ${3 * count} tests across ${3 * count} files`,
      stdout: "",
      exitCode: 1,
    });
    expect((await runs.get(form)!).whole).toEqual(plain);
  });
}
