// A test run asked for every export of every file as soon as one file let go of something that leads to `require.cache`: its `module`, a `require`, `process`. So it compiled
// files and functions that the executable drops, and the checker, which then saw more callers, expected other types of the parameters of those that both hold.
// iconv-lite does it without meaning to: `var module = modules[i]; mergeModules(exports, module)`; half of the functions of an express server differed for those two lines.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { buildEnvironment } from "./harness/flags";
import { describe, test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

// The tests stand in a folder of their own: what lies beside a test file or below it may load code from disk, and then every file may be named.
const product = {
  "product/pkg/package.json": `{ "name": "pkg", "sideEffects": false }`,
  "product/pkg/index.mjs": `export * as locales from "./locales/index.mjs";\nexport const used = 1;\nexport function shared(value) { return value; }\nexport function unread(value) { return shared(value); }\n`,
  "product/pkg/locales/index.mjs": `export { default as ar } from "./ar.mjs";\nexport { default as az } from "./az.mjs";\n`,
  "product/pkg/locales/ar.mjs": `export default function ar() { return { localeError: "ar" }; }\n`,
  "product/pkg/locales/az.mjs": `export default function az() { return { localeError: "az" }; }\n`,
  "product/pkg/old.cjs": `exports.named = 1;\nexports.other = function other() { return 2; };\n`,
  "product/main.ts": `import { used, shared } from "./pkg/index.mjs";\nimport { view } from "./view.cjs";\nconst { named } = require("./pkg/old.cjs");\nconsole.log(used, shared("x"), named, typeof view(String));\n`,
  // The file that a program begins at is called by the host, so it has a form of its own.
  "entry.ts": `import "./product/main.ts";\n`,
  "tests/entry.test.ts": `import { test } from "bun:test";\nimport "../product/main.ts";\ntest("runs", () => {});\n`,
};

const handsOn = {
  "its module object": `exports.view = function view(helper) { return helper(module); };`,
  "a variable named module that holds something else by then": `var list = [1];\nvar module = list[0];\nexports.view = function view(helper) { return helper(exports, module); };`,
  "process": `exports.view = function view(helper) { return helper(process); };`,
  "nothing": `exports.view = function view(helper) { return helper(1); };`,
};

const files = [...Object.keys(product), "product/view.cjs"].flatMap(name =>
  name.startsWith("product/") ? [name.slice("product".length)] : [],
);

/**
 * `file:position name form` of each function written below product/. A piece that the engine cuts out of functions which share it is none: whether it pays to cut one out
 * depends on how often the rest of the program has the same piece, and a test run holds the code of bun:test too. The piece bears the position of one of its users.
 */
function functionsOfProduct(mapPath: string): string[] {
  const rows = readFileSync(mapPath, "latin1").split("\n");
  const functions = rows.map(row => row.split("\t")).filter(columns => columns[0] === "F" && columns[8] !== "outlined");
  return functions
    .flatMap(columns => {
      const file = files.find(name => (columns[10] ?? "").endsWith(name));
      return file ? [`${file}:${columns[11]} ${columns[7]} ${columns[8]}`] : [];
    })
    .sort();
}

describe.skipIf(isWindows)(
  "a test run compiles the files and functions of the executable though a file hands on",
  () => {
    for (const [title, view] of Object.entries(handsOn)) {
      test(title, async () => {
        const folder = String(tempDir("aot-hands-on", { ...product, "product/view.cjs": view }));
        const build = async (map: string, ...command: string[]) => {
          await using child = Bun.spawn({
            cmd: [bunExe(), ...command],
            cwd: folder,
            env: { ...bunEnv, [buildEnvironment.mapFilePath]: join(folder, map) },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [out, err, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
          expect({ out, err, exitCode }).toEqual({ out: expect.any(String), err: expect.any(String), exitCode: 0 });
          return functionsOfProduct(join(folder, map));
        };
        const executable = await build(
          "executable.map",
          "build",
          "--compile",
          "--aot",
          "./entry.ts",
          "--outfile",
          "program",
        );
        const testRun = await build("test-run.map", "test", "--aot", "./tests/entry.test.ts");
        expect(executable).not.toBeEmpty();
        expect(testRun).toEqual(executable);
      });
    }
  },
);
