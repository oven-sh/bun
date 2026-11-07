// A tsconfig.json lists files, by name or by pattern. A build reads them for what they declare for every file. What the program
// is made of follows from what its code imports, so only a file that the code leads to can be wrongly in the program.
// Where the file system folds case, two names that differ in case alone are one file, and every row holds all the same.
import { expect } from "bun:test";
import { expectSameAnswerAsBunRun, expectWhatEachProjectReports, type Files } from "./harness/projects";
import { test } from "./supported";

const compilerOptions = {
  strict: true,
  noEmit: true,
  module: "preserve",
  moduleResolution: "bundler",
  target: "esnext",
  types: [],
};
const tsconfig = (lists: { files?: string[]; include?: string[] } = {}) =>
  JSON.stringify({ compilerOptions, ...lists });
const twoModules = { "Same.ts": "export const a = 1;\n", "same.ts": "export const a = 2;\n" };
const importsNothing = "console.log(1 + 1);\n";

const unreached: [string, Files][] = [
  ["two modules whose names differ in case alone", { "main.ts": importsNothing, ...twoModules }],
  [
    "a module beside the one that the program imports, named like it but for case",
    { "main.ts": `import { a } from "./Same";\nconsole.log(a + 1);\n`, ...twoModules },
  ],
  [
    "two folders whose names differ in case alone",
    { "main.ts": importsNothing, "Lib/a.ts": twoModules["Same.ts"], "lib/a.ts": twoModules["same.ts"] },
  ],
  [
    "two scripts whose names differ in case alone",
    { "main.ts": importsNothing, "Same.ts": "const one = 1;\n", "same.ts": "const two = 2;\n" },
  ],
  [
    "two files of declarations whose names differ in case alone",
    {
      "main.ts": importsNothing,
      "Same.d.ts": "declare const one: number;\n",
      "same.d.ts": "declare const two: number;\n",
    },
  ],
  [
    "a script named like the entry point but for case",
    { "main.ts": importsNothing, "Main.ts": "const two = 2;\nconsole.log(1 + 1);\n" },
  ],
  [
    "a module that nothing imports, which imports both",
    {
      "main.ts": importsNothing,
      ...twoModules,
      "user.ts": `import { a } from "./Same";\nimport { a as b } from "./same";\nexport const c = a + b;\n`,
    },
  ],
  [
    "a script that nothing imports, which spells the name of a module otherwise than the program does",
    {
      "main.ts": `import { a } from "./same";\nconsole.log(a);\n`,
      "same.ts": twoModules["same.ts"],
      "a-script.ts": `/// <reference path="./Same.ts" />\nconst one = 1;\n`,
    },
  ],
  [
    `two modules that "include" matches`,
    { "main.ts": importsNothing, ...twoModules, "tsconfig.json": tsconfig({ include: ["*.ts"] }) },
  ],
  [
    `two modules that "files" names`,
    {
      "main.ts": importsNothing,
      ...twoModules,
      "tsconfig.json": tsconfig({ files: ["main.ts", "Same.ts", "same.ts"] }),
    },
  ],
  [
    `a file that "files" names and that is not there`,
    { "main.ts": importsNothing, "tsconfig.json": tsconfig({ files: ["main.ts", "gone.ts"] }) },
  ],
  [
    `JavaScript that "files" names in a project that allows none`,
    {
      "main.ts": importsNothing,
      "other.js": "export const a = 1;\n",
      "tsconfig.json": tsconfig({ files: ["main.ts", "other.js"] }),
    },
  ],
];

test.concurrent.each(unreached)("beside the program: %s", async (_, files) => {
  await expectSameAnswerAsBunRun({ "tsconfig.json": tsconfig(), ...files });
});

const reached: [string, string][] = [
  ["for their values", `import { a } from "./Same";\nimport { a as b } from "./same";\nconsole.log(a + b);\n`],
  [
    "for their types",
    `import type { a } from "./Same";\nimport type { a as b } from "./same";\nconst c: typeof a | typeof b = 2;\nconsole.log(c);\n`,
  ],
];

test.concurrent.each(reached)(
  "the program imports two modules whose names differ in case alone, %s",
  async (_, main) => {
    const reported = await expectWhatEachProjectReports({
      "tsconfig.json": tsconfig(),
      "main.ts": main,
      ...twoModules,
    });
    expect(reported).toEqual(["main.ts TS1149"]);
  },
);
