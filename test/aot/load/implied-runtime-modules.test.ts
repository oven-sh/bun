import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "../harness/run";
import { declared, runtimeUse } from "../runtime-use-harness";
import { describe, test } from "../supported";

const exe = (name: string) => name + (isWindows ? ".exe" : "");
const COMPILED = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };
// What process.nextTick implies and a program without it does not hold.
const QUEUE = "module internal/process/next_tick_queue";

type Files = Record<string, string>;

const mainFile = (text: string): Files => ({ "main.ts": declared + text });

async function modulesOf(files: Files) {
  const { lines, stdout, stderr, exitCode } = await runtimeUse(files);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: expect.any(String), stderr: expect.any(String), exitCode: 0 });
  return new Set(lines);
}

const included: [name: string, files: Files][] = [
  ["a member read", mainFile("process.nextTick(() => {});\n")],
  ["a destructuring pattern", mainFile("const { nextTick } = process;\nnextTick(() => {});\n")],
  ["a const alias", mainFile("const own = process;\nown.nextTick(() => {});\n")],
  [
    "a use in a JavaScript dependency",
    {
      ...mainFile('import "waits";\n'),
      "node_modules/waits/package.json": JSON.stringify({ name: "waits", version: "1.0.0", main: "index.js" }),
      "node_modules/waits/index.js": "process.nextTick(() => {});\n",
      "node_modules/waits/index.d.ts": "export {};\n",
    },
  ],
];

// One program: a string literal with the same text, a use in code that folding removes, a parameter named process, a use in a file imported only for its types.
const notIncluded: Files = {
  ...mainFile(`import type { T } from "./only-types";
const t: T = 1;
console.log(t, "process.nextTick", "Bun.sql");
if (false) process.nextTick(() => {});
function wait(process: { nextTick(callback: () => void): void }) {
  process.nextTick(() => {});
}
wait({ nextTick() {} });
`),
  "only-types.ts": `${declared}export type T = number;
export function unused() {
  process.nextTick(() => {});
}
`,
};

describe.concurrent("compile/aot/load/implied-runtime-modules", () => {
  test.each(included)("included: %s", async (_name, files) => {
    expect(await modulesOf(files)).toContain(QUEUE);
  });

  test("not included where nothing uses the built-in, and another built-in implies another module", async () => {
    const [withoutUse, withUse] = await Promise.all([
      modulesOf(notIncluded),
      modulesOf(mainFile("console.log(typeof Bun.sql);\n")),
    ]);
    expect([QUEUE, "module bun:sql"].filter(line => withoutUse.has(line))).toEqual([]);
    expect(withUse).toContain("module bun:sql");
  });

  test("native code finds an implied module", async () => {
    using dir = tempDir("aot-load-implied-modules", { "main.mjs": 'process.stdout.write("x\\n");\n' });
    const folder = String(dir);
    const program = join(folder, exe("program"));
    const built = await run([bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", program], folder);
    expect(built).toEqual({ stdout: expect.any(String), stderr: expect.any(String), exitCode: 0 });
    expect(await run([program], folder, COMPILED)).toMatchObject({ stdout: "x\n", exitCode: 0 });
  });
});
