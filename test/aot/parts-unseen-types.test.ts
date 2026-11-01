// Over layers a program of test files reads its test files and no file for the sake of their types: neither what they import nor the packages of types that are
// installed. The load still took the types of Bun for present wherever `@types/bun` lies in node_modules, so the declarations that stand in for them (every global of
// the run time is `any`) were left out as well: "TS2591: Cannot find name 'process'" for each global, and messages that followed from the rest, after which the file was
// compiled without its types. What such a program cannot see is `any`, as under TypeScript's own `noResolve`, and nothing is said about it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// Laid out as the real ones are: the first file of a package names the others and declares nothing.
const packagesOfTypes = {
  "node_modules/@types/bun/package.json": `{ "name": "@types/bun", "version": "1.0.0", "types": "index.d.ts" }`,
  "node_modules/@types/bun/index.d.ts": `/// <reference types="bun-types" />\n`,
  "node_modules/bun-types/package.json": `{ "name": "bun-types", "version": "1.0.0", "types": "index.d.ts" }`,
  "node_modules/bun-types/index.d.ts": `/// <reference path="./globals.d.ts" />\n/// <reference path="./test.d.ts" />\n`,
  "node_modules/bun-types/globals.d.ts":
    `declare var process: { [name: string]: any; env: Record<string, string | undefined>; stderr: { write(text: string): void } };\n` +
    `declare var Buffer: { from(text: string): Uint8Array };\ndeclare var require: any;\n`,
  "node_modules/bun-types/test.d.ts": `declare module "bun:test" { export function test(name: string, run: () => void | Promise<void>): void; }\n`,
};

const project = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": `{ "compilerOptions": { "strict": true, "module": "preserve", "moduleResolution": "bundler", "noEmit": true, "skipLibCheck": true } }`,
  "load.ts":
    `export interface Found { id: number; name: string }\n` +
    `export async function load(id: number): Promise<Found> { await Promise.resolve(); return { id, name: "n" + id }; }\n` +
    `export class Store { held: Found[] = []; put(found: Found) { this.held.push(found); return this; } }\n`,
  "a.test.ts":
    `import { test } from "bun:test";\nimport { load, Store, type Found } from "./load";\n` +
    `class Wider extends Store { get size() { return this.held.length; } }\n` +
    `test("a", async () => {\n  const found: Found = await load(1);\n  const bytes = Buffer.from(found.name);\n  const home = process.env.HOME ?? "";\n` +
    `  process.stderr.write("RAN " + [found.id, bytes.length, typeof home, new Wider().put(found).size].join(" ") + "\\n");\n});\n`,
};

async function seen(directory: string, flags: string[], words: string) {
  // A program of test files says what its checker found only beside the log of the stages.
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" };
  const { stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return { lines: stderr.split("\n").filter(line => /^RAN|^(warn|error): TS/.test(line)), exitCode };
}

test.concurrent.each([
  ["the packages of types are installed", { ...project, ...packagesOfTypes }],
  ["no package of types is installed", project],
])(
  "%s",
  async (_, files) => {
    using dir = tempDir("aot-what-a-test-file-cannot-see-over-layers", files);
    const plain = await seen(String(dir), [], "");
    expect(plain).toEqual({ lines: ["RAN 1 2 string 1"], exitCode: 0 });
    expect(await seen(String(dir), ["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(String(dir), ["--aot"], "TestRunLayers:1")).toEqual(plain);
    expect(await seen(String(dir), ["--aot"], "TestRunLayers:3")).toEqual(plain);
  },
  120_000,
);
