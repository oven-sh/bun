import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, spawned } from "../run-programs";
import { declared, runtimeUse } from "../runtime-use-harness";
import { describe, test } from "../supported";

const exe = (name: string) => name + (isWindows ? ".exe" : "");
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
const STREAMS = ["module node:tty", "module node:fs", "module internal/fs/streams"];
// The warning printer is in every program, and it requires node:fs.
const ONLY_WITH_STREAMS = ["module node:tty", "module internal/fs/streams"];

type Files = Record<string, string>;

const mainFile = (text: string): Files => ({ "main.ts": declared + text });

async function modulesOf(files: Files) {
  const { lines, stdout, stderr, exitCode } = await runtimeUse(files);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: expect.any(String), stderr: expect.any(String), exitCode: 0 });
  return new Set(lines);
}

const included: [name: string, files: Files][] = [
  ["a member read", mainFile('process.stdout.write("x\\n");\n')],
  ["another member that implies the same modules", mainFile('process.stderr.write("x\\n");\n')],
  ["a destructuring pattern", mainFile('const { stdout } = process;\nstdout.write("x\\n");\n')],
  ["a const alias", mainFile('const own = process;\nown.stdout.write("x\\n");\n')],
  [
    "a use in a JavaScript dependency",
    {
      ...mainFile('import "writes";\n'),
      "node_modules/writes/package.json": JSON.stringify({ name: "writes", version: "1.0.0", main: "index.js" }),
      "node_modules/writes/index.js": 'process.stdout.write("x\\n");\n',
      "node_modules/writes/index.d.ts": "export {};\n",
    },
  ],
];

const notIncluded: [name: string, files: Files][] = [
  ["no use", mainFile('console.log("x");\n')],
  ["a string literal with the same text", mainFile('console.log("process.stdout");\n')],
  ["a use in code that folding removes", mainFile('if (false) process.stdout.write("x\\n");\nconsole.log("x");\n')],
  [
    "a parameter named process",
    mainFile(`function write(process: { stdout: { write(text: string): void } }) {
  process.stdout.write("x");
}
write({ stdout: { write() {} } });
`),
  ],
  [
    "a use in a file imported only for its types",
    {
      ...mainFile('import type { T } from "./only-types";\nconst t: T = 1;\nconsole.log(t);\n'),
      "only-types.ts": `${declared}export type T = number;
export function unused() {
  process.stdout.write("x\\n");
}
`,
    },
  ],
];

describe.concurrent("compile/aot/load/implied-runtime-modules", () => {
  test.each(included)(
    "included: %s",
    (_name, files) =>
      slot(async () => {
        const modules = await modulesOf(files);
        expect(STREAMS.filter(line => !modules.has(line))).toEqual([]);
      }),
    600_000,
  );

  test.each(notIncluded)(
    "not included: %s",
    (_name, files) =>
      slot(async () => {
        const modules = await modulesOf(files);
        expect(ONLY_WITH_STREAMS.filter(line => modules.has(line))).toEqual([]);
      }),
    600_000,
  );

  test(
    "another built-in implies another module",
    () =>
      slot(async () => {
        const withUse = await modulesOf(mainFile("console.log(typeof Bun.sql);\n"));
        const withoutUse = await modulesOf(mainFile('console.log("x");\n'));
        expect({ withUse: withUse.has("module bun:sql"), withoutUse: withoutUse.has("module bun:sql") }).toEqual({
          withUse: true,
          withoutUse: false,
        });
      }),
    600_000,
  );

  test(
    "native code finds an implied module",
    () =>
      slot(async () => {
        using dir = tempDir("aot-load-implied-modules", { "main.mjs": 'process.stdout.write("x\\n");\n' });
        const folder = String(dir);
        const program = join(folder, exe("program"));
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", program],
          folder,
          bunEnv,
        );
        expect({ stdout: built.stdout, stderr: built.stderr, exitCode: built.exitCode }).toEqual({
          stdout: expect.any(String),
          stderr: expect.any(String),
          exitCode: 0,
        });
        const ran = await spawned([program], folder, COMPILED);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
          stdout: "x\n",
          exitCode: 0,
          signal: null,
        });
      }),
    600_000,
  );
});
