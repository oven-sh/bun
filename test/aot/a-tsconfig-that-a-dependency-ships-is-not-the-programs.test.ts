// A package may ship the tsconfig.json that its author builds it with. @redocly/openapi-core 1.34.6 does, and it extends "../../tsconfig.json", the root of a repository
// that is not published. Where a test run is cut into layers, the entry points of the layer of packages are files of packages, so such a file was taken for the
// configuration of the whole layer: "TS5083: Cannot read file", and none of the test files ran. As one program, and in plain Bun, nobody reads it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

const fields = `
  class Base { seen: string; constructor() { this.seen = Object.keys(this).join(); } }
  class Derived extends Base { x?: number; y = 1; }
  export const told = () => { const d = new Derived(); return JSON.stringify([Object.keys(d).sort(), "x" in d]); };`;
const asks = (say: string) => `
  import * as a from "configured";
  import * as b from "other";
  import * as c from "./own";
  ${say.replace("SAY", `console.log("SAID", a.told(), b.told(), c.told())`)}`;
const old = `{ "compilerOptions": { "target": "es2015", "useDefineForClassFields": false, "experimentalDecorators": true, "strict": false } }`;
const modern = `{ "compilerOptions": { "target": "esnext", "useDefineForClassFields": true, "strict": true } }`;
const twoPackages = (ofProject: string, ofDependency: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "tsconfig.json": ofProject,
  "node_modules/configured/package.json": `{ "name": "configured", "version": "1.0.0", "main": "index.ts" }`,
  "node_modules/configured/tsconfig.json": ofDependency,
  "node_modules/configured/index.ts": fields,
  "node_modules/other/package.json": `{ "name": "other", "version": "1.0.0", "main": "index.ts" }`,
  "node_modules/other/index.ts": fields,
  "own.ts": fields,
  "a.test.ts": `import { test } from "bun:test";${asks(`test("x", () => { SAY; });`)}`,
  "main.ts": asks("SAY;"),
});

const projects: Record<string, Record<string, string>> = {
  "it extends a file that is not published": {
    "package.json": `{ "name": "p", "type": "module" }`,
    "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "main": "lib/index.js" }`,
    "node_modules/pkg/tsconfig.json": `{ "extends": "../../not-published/tsconfig.json", "compilerOptions": { "rootDir": "src", "outDir": "lib" } }`,
    "node_modules/pkg/lib/index.js": `exports.v = 1;`,
    "a.test.ts": `import { test } from "bun:test";\nimport { v } from "pkg";\ntest("x", () => { console.log("SAID", v); });`,
    "main.ts": `import { v } from "pkg";\nconsole.log("SAID", v);`,
  },
  // Its own files are still checked by it: under the project's "strict" the function would be a type error, and the file would lose its types.
  "it is looser than the project": {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
    "node_modules/inner/package.json": `{ "name": "inner", "version": "1.0.0", "main": "./lib.ts" }`,
    "node_modules/inner/tsconfig.json": `{ "compilerOptions": { "strict": false } }`,
    "node_modules/inner/lib.ts": `export function first(list: number[]): number { return list.length ? list[0] : undefined; }`,
    "node_modules/second/package.json": `{ "name": "second", "version": "1.0.0", "main": "./lib.ts" }`,
    "node_modules/second/lib.ts": `export function twice(n: number): number { return n * 2; }`,
    "a.test.ts": `import { test } from "bun:test";\nimport { first } from "inner";\nimport { twice } from "second";\ntest("x", () => { console.log("SAID", first([]), first([4]), twice(2)); });`,
    "main.ts": `import { first } from "inner";\nimport { twice } from "second";\nconsole.log("SAID", first([]), first([4]), twice(2));`,
  },
  "it states older options than the project": twoPackages(modern, old),
  "it states newer options than the project": twoPackages(old, modern),
};

const forms: [string, string | undefined, string[]][] = [
  ["one program", "TestRunLayers:0", ["--aot"]],
  ["two layers", "TestRunLayers:2,TestRunPartFiles:1", ["--aot", "--parallel=2"]],
  ["three layers", "TestRunLayers:3,TestRunPartFiles:1", ["--aot", "--parallel=2"]],
  ["three layers in one process", "TestRunLayers:3,TestRunPartFiles:1", ["--aot", "--isolate"]],
];

for (const [title, files] of Object.entries(projects)) {
  test(title, async () => {
    using dir = tempDir("a-tsconfig-that-a-dependency-ships", files);
    const said = async (words: string | undefined, ...cmd: string[]) => {
      const { stdout, stderr, exitCode } = await run(cmd, String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words });
      expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
      expect(stderr).not.toContain("TS100009");
      return stdout.split("\n").filter(line => line.startsWith("SAID"));
    };
    const plain = await said(undefined, bunExe(), "test");
    expect(plain.length).toBe(1);
    const compiled = await Promise.all(
      forms.map(async ([form, words, flags]) => [form, await said(words, bunExe(), "test", ...flags)]),
    );
    expect(compiled).toEqual(forms.map(([form]) => [form, plain]));
    // The bundler goes by the tsconfig.json beside each file, a dependency's too, so an executable is held against an executable.
    await said(undefined, bunExe(), "build", "--compile", "main.ts", "--outfile", "stock");
    await said(undefined, bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "built");
    expect(await said(undefined, join(String(dir), "built"))).toEqual(
      await said(undefined, join(String(dir), "stock")),
    );
  });
}
