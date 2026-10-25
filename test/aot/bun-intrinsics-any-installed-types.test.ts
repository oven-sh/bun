import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const program = `
import type { int32 } from "bun";
import { inspect } from "bun";
declare const console: { log(...values: unknown[]): void };
type Inline = import("bun").int32;
function half(n: int32): number { return n / 2; }
function twice(n: Inline): number { return n * 2; }
const given: number[] = JSON.parse("[4, 1.5]");
for (const n of given) console.log(half(n | 0), twice(n));
console.log(typeof inspect);
`;
const options = (more: object) => JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false, ...more } });
const worlds: Record<string, Record<string, string>> = {
  "the bun-types of this repository": {
    "tsconfig.json": options({
      typeRoots: [join(import.meta.dir, "..", "..", "packages")],
      types: ["bun-types"],
      skipLibCheck: true,
    }),
  },
  "a bun-types that lacks the member": {
    "tsconfig.json": options({ typeRoots: ["./types"], types: ["bun"] }),
    "types/bun/package.json": JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
    "types/bun/index.d.ts": `declare module "bun" { function inspect(value: unknown): string; }\n`,
  },
  "a bun-types that has it too": {
    "tsconfig.json": options({ typeRoots: ["./types"], types: ["bun"] }),
    "types/bun/package.json": JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
    "types/bun/index.d.ts": `declare module "bun" { type int32 = number; function inspect(value: unknown): string; }\n`,
  },
  "no types at all": {
    "tsconfig.json": options({ typeRoots: ["./no-types-here"] }),
  },
  "a declaration of the name by a stranger": {
    "tsconfig.json": options({ typeRoots: ["./no-types-here"] }),
    "stranger.d.ts": `declare module "bun" { type int32 = string; }\n`,
    "main.ts": `/// <reference path="./stranger.d.ts" />` + program,
  },
};

const programWithTheGlobal = `
declare const console: { log(...values: unknown[]): void };
function half(n: Bun.int32): number { return n / 2; }
const given: number[] = JSON.parse("[4, 1.5]");
for (const n of given) console.log(half(n));
console.log(typeof Bun.inspect);
`;
const typesThatDeclareTheGlobal = {
  "tsconfig.json": options({ typeRoots: ["./types"], types: ["bun"] }),
  "types/bun/package.json": JSON.stringify({ name: "@types/bun", version: "1.0.0", types: "index.d.ts" }),
  "types/bun/index.d.ts": `/// <reference path="./bun.ns.d.ts" />\ndeclare module "bun" { function inspect(value: unknown): string; namespace Serve { interface Options { port: number } } }\n`,
  "types/bun/bun.ns.d.ts": `import * as BunModule from "bun";\ndeclare global { export import Bun = BunModule; }\n`,
};

async function buildAndRun(files: Record<string, string>) {
  using dir = tempDir("aot-global-of-bun", files);
  const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode: built } = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
    String(dir),
  );
  if (built) return { said, built };
  const { stdout, stderr, exitCode } = await run([outfile], String(dir));
  return { stdout, stderr, exitCode };
}

for (const [world, files] of Object.entries({
  ...worlds,
  "a bun-types that declares the global too": typesThatDeclareTheGlobal,
})) {
  test(`the global Bun has what "bun" has with ${world}`, async () => {
    const main =
      "main.ts" in files ? `/// <reference path="./stranger.d.ts" />` + programWithTheGlobal : programWithTheGlobal;
    expect(await buildAndRun({ ...files, "main.ts": main })).toEqual({
      said: expect.stringContaining("TS100031: Parameter 'n' of 'half' is declared 'int32'"),
      built: 1,
    });
    expect(await buildAndRun({ ...files, "main.ts": main.replace("half(n))", "half(n | 0))") })).toEqual({
      stdout: "2\n0.5\nfunction\n",
      stderr: "",
      exitCode: 0,
    });
  }, 120_000);
}

test("the types that are installed are seen through the global Bun", async () => {
  const uses = (port: string) =>
    `declare const console: { log(...values: unknown[]): void };\nconst options: Bun.Serve.Options = { port: ${port} };\nconsole.log(options.port, Bun.inspect(1));\n`;
  expect(await buildAndRun({ ...typesThatDeclareTheGlobal, "main.ts": uses("8080") })).toEqual({
    stdout: "8080 1\n",
    stderr: "",
    exitCode: 0,
  });
  expect(await buildAndRun({ ...typesThatDeclareTheGlobal, "main.ts": uses(`"a text"`) })).toEqual({
    said: expect.stringContaining("TS2322"),
    built: 1,
  });
}, 120_000);

test("without the types the build goes on", async () => {
  for (const main of [
    `console.log(typeof Bun.file);`,
    `const port: Bun.Serve.Options["port"] = 1;\nconsole.log(port);`,
  ]) {
    using dir = tempDir("aot-global-of-bun", {
      ...worlds["no types at all"],
      "main.ts": `declare const console: { log(...values: unknown[]): void };\n` + main,
    });
    const { stderr: said, exitCode: built } = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", join(String(dir), "out")],
      String(dir),
    );
    expect({ errors: said.split("\n").filter(line => line.startsWith("error")), built }).toEqual({
      errors: [],
      built: 0,
    });
  }
}, 120_000);

// `bun check` ends with the note "Bun's type definitions (console, fetch, Bun, bun:test) are not installed. Run: bun add -d @types/bun". A build says nothing.
test.todo("without the types the build says how to get them");

for (const [world, files] of Object.entries(worlds)) {
  test(`int32 of "bun" is a 32-bit integer with ${world}`, async () => {
    using dir = tempDir("aot-intrinsics-of-bun", { "main.ts": program, ...files });
    const outfile = join(String(dir), "out" + (isWindows ? ".exe" : ""));
    const { stderr: said, exitCode: built } = await run(
      [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
      String(dir),
    );
    expect({
      errors: said
        .split("\n")
        .filter(line => line.startsWith("error: "))
        .map(line => line.slice(0, 60)),
      built,
    }).toEqual({ errors: ["error: TS100031: Parameter 'n' of 'twice' is declared 'int32"], built: 1 });
  }, 120_000);
}
