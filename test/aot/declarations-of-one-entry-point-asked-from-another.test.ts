import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "path";
import { run as spawned } from "./harness/run";
import { test } from "./supported";

const registry = `class Registry {\n  static create(): Registry { return new Registry(); }\n  value = 41;\n}\n`;
const codedError = `interface CodedError extends Error { code: number }\nconst error = Object.assign(new Error("e"), { code: 41 }) as CodedError;\n`;
const factories = `export interface Factory { create(): { value: number } }\nexport const table: { factory: Factory | null; count: number } = { factory: null, count: 1 };\nexport function make(factory: Factory): number {\n  table.factory = factory;\n  return table.factory.create().value + table.count;\n}\n`;
const codes = `export interface Coded { code: number }\nexport const table: { last: Coded | null; count: number } = { last: null, count: 1 };\nexport function note(coded: Coded): number {\n  table.last = coded;\n  return table.last.code + table.count;\n}\n`;
const startsTheWorker = (sum: string) =>
  `const worker = new Worker(new URL("./worker.ts", import.meta.url).href);\nworker.onmessage = event => {\n  console.log(${sum});\n  worker.terminate();\n};\n`;

const programs: Record<string, Record<string, string>> = {
  "a class with a static member in the worker, an object type with that member behind the entry point": {
    "shared.ts": factories,
    "worker.ts": registry + `postMessage(Registry.create().value);\n`,
    "main.ts": `import { table } from "./shared";\n` + startsTheWorker("event.data + table.count"),
  },
  "a class with a static member in the entry point, an object type with that member behind the worker": {
    "shared.ts": factories,
    "worker.ts": `import { table } from "./shared";\npostMessage(table.count);\n`,
    "main.ts": registry + startsTheWorker("event.data + Registry.create().value"),
  },
  "an interface below a built-in type in the worker, an object type with its member behind the entry point": {
    "shared.ts": codes,
    "worker.ts": codedError + `postMessage(error.code);\n`,
    "main.ts": `import { table } from "./shared";\n` + startsTheWorker("event.data + table.count"),
  },
  "an interface below a built-in type in the entry point, an object type with its member behind the worker": {
    "shared.ts": codes,
    "worker.ts": `import { table } from "./shared";\npostMessage(table.count);\n`,
    "main.ts": codedError + startsTheWorker("event.data + error.code"),
  },
  "the worker hands its class to a function that both import": {
    "shared.ts": factories,
    "worker.ts": `import { make } from "./shared";\n` + registry + `postMessage(make(Registry));\n`,
    "main.ts":
      `import { make } from "./shared";\n` + startsTheWorker("event.data + make({ create: () => ({ value: -1 }) })"),
  },
  "the worker hands its error to a function that both import": {
    "shared.ts": codes,
    "worker.ts": `import { note } from "./shared";\n` + codedError + `postMessage(note(error));\n`,
    "main.ts": `import { note } from "./shared";\n` + startsTheWorker("event.data + note({ code: -1 })"),
  },
};

for (const [name, files] of Object.entries(programs)) {
  for (const threads of [1, 8]) {
    test.concurrent(
      `${name}: ${threads} threads`,
      async () => {
        using dir = tempDir("aot-entry-points", files);
        const cwd = String(dir);
        const built = await spawned(
          [
            bunExe(),
            "build",
            "--compile",
            "--aot",
            `--aot-threads=${threads}`,
            "./main.ts",
            "./worker.ts",
            "--outfile",
            "./app",
          ],
          cwd,
        );
        expect(built.exitCode, built.stderr).toBe(0);
        expect(await spawned([join(cwd, "app")], cwd)).toEqual(await spawned([bunExe(), "run", "./main.ts"], cwd));
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
