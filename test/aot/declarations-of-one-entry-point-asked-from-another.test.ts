// A Worker beside the entry point: test/aot/parallel/declarations.
import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as spawned } from "./harness/run";
import { test } from "./supported";

const registry = `class Registry {\n  static create(): Registry { return new Registry(); }\n  value = 41;\n}\n`;
const factories = `export interface Factory { create(): { value: number } }\nexport const table: { factory: Factory | null; count: number } = { factory: null, count: 1 };\nexport function make(factory: Factory): number {\n  table.factory = factory;\n  return table.factory.create().value + table.count;\n}\n`;

// Which entry points one thread checks in a row goes by their number, their sizes and the number of threads. Every other one asks for what those behind it declare.
const neighbors: Record<string, [asks: string, declares: string]> = {
  "interfaces below a built-in type": [
    `export function read(value: any) {\n  return value.first.second;\n}\n`,
    `interface Ranged extends Array<number> {\n  from: number;\n}\nconst list = [2, 1].slice() as Ranged;\nlist.from = 1;\nconsole.log(list.sort().from + list.length);\nexport {};\n`,
  ],
  "classes with a static member": [
    `export interface Factory {\n  create(): unknown;\n}\nexport function make(factory: Factory) {\n  return factory.create();\n}\n`,
    `class Registry {\n  static create(): Registry {\n    return new Registry();\n  }\n  self(): this {\n    return this;\n  }\n}\nclass Named extends Registry {\n  name = "n";\n}\nconsole.log(new Named().self().name, Registry.create() instanceof Registry);\nexport {};\n`,
  ],
};

for (const [name, [asks, declares]] of Object.entries(neighbors)) {
  for (const threads of [1, 2, 4, 16]) {
    test.concurrent(
      `${name} in every other of many small entry points: ${threads} threads`,
      async () => {
        const files: Record<string, string> = {};
        for (let pair = 100; pair < 292; pair++) {
          files[`${pair}-asks.ts`] = asks;
          files[`${pair}-declares.ts`] = declares;
        }
        using dir = tempDir("aot-entry-points", files);
        const { stdout, stderr, exitCode } = await spawned(
          [bunExe(), "check", "--aot", `--threads=${threads}`, ...Object.keys(files)],
          String(dir),
        );
        const errors = (stdout + stderr).match(/^.*\berror TS\d+.*$/gm) ?? [];
        expect({ errors: errors.slice(0, 3), exitCode }).toEqual({ errors: [], exitCode: 0 });
      },
      120_000,
    );
  }
}

for (const mode of ["--aot", "--debug-aot"]) {
  test.concurrent(
    `bun test ${mode}: a class with a static member in the test file, an object type with that member behind the preload`,
    async () => {
      using dir = tempDir("aot-entry-points", {
        "shared.ts": factories,
        "preload.ts": `import { table } from "./shared";\n(globalThis as any).count = table.count;\n`,
        "registry.test.ts":
          `import { expect, test } from "bun:test";\n` +
          registry +
          `test("the sum", () => {\n  expect((globalThis as any).count + Registry.create().value).toBe(42);\n});\n`,
      });
      const { stderr, exitCode } = await spawned(
        [bunExe(), "test", mode, "--preload", "./preload.ts", "./registry.test.ts"],
        String(dir),
      );
      expect(stderr).toContain(" 1 pass");
      expect(stderr).toContain(" 0 fail");
      expect(exitCode).toBe(0);
    },
    120_000,
  );
}
