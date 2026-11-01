// A setup file under `[test] preload` mocks a CommonJS package with a factory that gives no `default`, and a file of the project imports the
// default. In `bun test` the mock stands in place of the package and answers for every name: the import links and the default is undefined. So a
// call on it throws a TypeError in each test, and `typeof` says "undefined".
// A compiled run refused the link instead (SyntaxError: Missing 'default' export), as `bun test` did before it followed Vitest on module mocks. Over
// layers the package lies in another image than its importer, which asks the record of the file.
import { afterAll, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "../supported";

const importers = {
  "the default": `import validator from "validator";\nexport const check = () => validator.isEmail();\n`,
  "the default and a name": `import validator, { isEmail } from "validator";\nexport const check = () => isEmail() + typeof validator;\n`,
  // What was the same before.
  "a name": `import { isEmail } from "validator";\nexport const check = () => isEmail();\n`,
  "the namespace": `import * as validator from "validator";\nexport const check = () => validator.isEmail() + String(validator.default);\n`,
  "require": `const validator = require("validator");\nexport const check = () => validator.isEmail();\n`,
};
const names = Object.keys(importers) as (keyof typeof importers)[];

// The importers are the files of one project, each with two test files of its own: a1.test.ts and b1.test.ts import src/check-1.ts.
const project: Record<string, string> = {
  "package.json": `{ "name": "p" }`,
  "bunfig.toml": `[test]\npreload = ["./setup.ts"]\n`,
  "node_modules/validator/package.json": `{ "name": "validator", "main": "index.js" }`,
  "node_modules/validator/index.js": `exports.isEmail = () => "real";\n`,
  "setup.ts": `import { mock } from "bun:test";\nmock.module("validator", () => ({ isEmail: () => "mocked in the setup file" }));\n`,
};
names.forEach((name, index) => {
  project[`src/check-${index + 1}.ts`] = importers[name];
  for (const letter of ["a", "b"])
    project[`${letter}${index + 1}.test.ts`] =
      `import { test } from "bun:test";\nimport { check } from "./src/check-${index + 1}";\ntest("${letter}", () => { console.error("OUT ${letter}", check()); });\n`;
});

type Way = { flags: string[]; words?: string };
type Run = { linesOf: Map<string, string[]>; exitCode: number };

/**
 * Every way is one compiled run of the project, held to a plain run importer by importer. A run in layers compiles Bun's own library too, under a
 * sanitizer most of a minute of processor time, whatever the project holds. The ways are dealt to several test files, and each file makes the
 * plain run for itself. The runs come one behind the other: beside other files that build, more builds at once only make each test longer.
 */
export function answersAsPlainBunTest(ways: Way[]) {
  let folder: ReturnType<typeof tempDir> | undefined;
  afterAll(() => folder?.[Symbol.dispose]());
  const runs = new Map<string, Promise<Run>>();
  let last: Promise<unknown> = Promise.resolve();

  function ran(flags: string[], words = "") {
    return runs.getOrInsertComputed(JSON.stringify([flags, words]), () => {
      const run = last.then(async () => {
        const dir = String((folder ??= tempDir("aot-mock-without-a-default-over-layers", project)));
        await using child = Bun.spawn({
          cmd: [bunExe(), "test", ...flags],
          cwd: dir,
          env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
          stdio: ["ignore", "pipe", "pipe"],
        });
        const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
        // What a test file prints stands under its name.
        const linesOf = new Map<string, string[]>();
        let importer = "";
        for (const line of stderr.replaceAll(dir, "<dir>").split("\n")) {
          const [, number] = line.match(/^[ab](\d)\.test\.ts:$/) ?? [];
          if (number) importer = names[Number(number) - 1];
          else if (/^OUT|Error: /.test(line)) linesOf.getOrInsertComputed(importer, () => []).push(line);
        }
        for (const [name, lines] of linesOf) linesOf.set(name, [...new Set(lines)].sort());
        return { linesOf, exitCode };
      });
      last = run.catch(() => {});
      return run;
    });
  }

  test.each(names)(
    "%s",
    async name => {
      const plain = (await ran(["--isolate"])).linesOf.get(name);
      if (name === "the default")
        expect(plain).toEqual(["TypeError: undefined is not an object (evaluating 'validator.isEmail')"]);
      else if (name === "the default and a name")
        expect(plain).toEqual(["OUT a mocked in the setup fileundefined", "OUT b mocked in the setup fileundefined"]);
      else expect(plain).toHaveLength(2);
      for (const { flags, words } of ways)
        expect((await ran(["--aot", ...flags], words)).linesOf.get(name)).toEqual(plain);
    },
    240_000,
  );

  // The tests of "the default" throw, so a run ends with 1. Nothing is printed outside the test files.
  test("every run ends as the plain one", async () => {
    const plain = await ran(["--isolate"]);
    expect({ exitCode: plain.exitCode, outside: plain.linesOf.get("") }).toEqual({ exitCode: 1, outside: undefined });
    for (const { flags, words } of ways) {
      const compiled = await ran(["--aot", ...flags], words);
      expect({ exitCode: compiled.exitCode, outside: compiled.linesOf.get("") }).toEqual({
        exitCode: 1,
        outside: undefined,
      });
    }
  }, 240_000);
}
