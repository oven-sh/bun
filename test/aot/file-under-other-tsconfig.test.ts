import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const options = `"strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "types": []`;
const declared = `declare const console: { log(...values: unknown[]): void };\n`;

const withoutPaths = `{ "compilerOptions": { ${options} } }`;
const withPaths = `{ "compilerOptions": { ${options}, "paths": { "the-app": ["./src/api.ts"] } } }`;
const withOtherPaths = `{ "compilerOptions": { ${options}, "paths": { "helpers/*": ["./helpers/*"] } } }`;
const withBaseUrl = `{ "compilerOptions": { ${options}, "baseUrl": "./src" } }`;
const extendsProgram = `{ "extends": "../tsconfig.json" }`;

function typeImport(specifier: string, program: string, nearest?: string): Record<string, string> {
  return {
    "app/tsconfig.json": program,
    "app/main.ts": `${declared}import { next } from "./mods/one/index";\nconsole.log(next({ n: 1 }));\n`,
    "app/src/api.ts": `export interface Settings { n: number }\n`,
    "app/mods/one/index.ts": `import type { Settings } from "${specifier}";\nexport function next(settings: Settings): number { return settings.n + 1; }\n`,
    ...(nearest && { "app/mods/tsconfig.json": nearest }),
  };
}

const accepted: Record<string, Record<string, string>> = {
  "an alias that only the other package has": {
    "app/tsconfig.json": withoutPaths,
    "app/main.ts": `${declared}import { four } from "../lib/index";\nconsole.log(four());\n`,
    "lib/tsconfig.json": `{ "compilerOptions": { ${options}, "paths": { "@util": ["./src/util.ts"] } } }`,
    "lib/index.ts": `import { twice } from "@util";\nexport function four(): number { return twice(2); }\n`,
    "lib/src/util.ts": `export function twice(n: number): number { return n * 2; }\n`,
  },
  "the same alias in both packages": {
    "app/tsconfig.json": `{ "compilerOptions": { ${options}, "paths": { "@/*": ["./src/*"] } } }`,
    "app/main.ts": `${declared}import { four, shape } from "../lib/index";\nimport { name, twice } from "@/util";\nconsole.log(name, twice("ab"), four(), shape().m);\n`,
    "app/src/util.ts": `export const name = "the application's";\nexport function twice(text: string): string { return text + text; }\nexport function make(): { text: string } { return { text: "app" }; }\n`,
    "lib/tsconfig.json": `{ "compilerOptions": { ${options}, "paths": { "@/*": ["./src/*"] } } }`,
    "lib/index.ts": `import { twice, make } from "@/util";\nexport function four(): number { return twice(2); }\nexport function shape() { return make(); }\n`,
    "lib/src/util.ts": `export function twice(n: number): number { return n * 2; }\nexport function make(): { n: number; m: number } { return { n: 1, m: 2 }; }\n`,
  },
  "a baseUrl, and a module with another ending": {
    "app/tsconfig.json": withoutPaths,
    "app/main.ts": `${declared}import { all } from "../lib/index";\nconsole.log(all());\n`,
    "lib/tsconfig.json": withBaseUrl,
    "lib/index.ts": `import { one } from "deep/one";\nimport { two } from "two.mjs";\nexport function all(): string { return one() + two(); }\n`,
    "lib/src/deep/one.ts": `export function one(): string { return "one"; }\n`,
    "lib/src/two.mts": `export function two(): string { return "two"; }\n`,
  },
  "a type import through paths that the nearest tsconfig.json inherits": typeImport(
    "the-app",
    withPaths,
    extendsProgram,
  ),
  "a type import through the program's baseUrl": typeImport("api", withBaseUrl),
  "a type import through a baseUrl that the nearest tsconfig.json inherits": typeImport(
    "api",
    withBaseUrl,
    extendsProgram,
  ),
};

// `bun run` erases a type import without resolving it. The build asks the nearest tsconfig.json first. What that cannot resolve, the program's own is asked:
// a build reports no error that `bun check` at the program's root does not.
const leftToTheProgram: Record<string, [specifier: string, program: string, nearest: string]> = {
  "the nearest has no paths": ["the-app", withPaths, withoutPaths],
  "the nearest has other paths": ["the-app", withPaths, withOtherPaths],
  "the nearest extends it and has paths of its own": [
    "the-app",
    withPaths,
    `{ "extends": "../tsconfig.json", "compilerOptions": { "paths": { "helpers/*": ["./helpers/*"] } } }`,
  ],
  "the nearest has a baseUrl": ["the-app", withPaths, `{ "compilerOptions": { ${options}, "baseUrl": "." } }`],
  "through its baseUrl, and the nearest has none": ["api", withBaseUrl, withoutPaths],
};

const buildCommand = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "program"];
const runFromSourceCommand = [bunExe(), "run", "--aot", "main.ts"];

for (const [what, files] of Object.entries(accepted)) {
  test(
    what,
    async () => {
      using dir = tempDir("another-tsconfig", files);
      const app = join(String(dir), "app");
      const plain = await run([bunExe(), "run", "main.ts"], app);
      expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      // Without Bun's declarations installed, TS2307 for an import that resolves at run time is only a warning.
      const built = await run(buildCommand, app);
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
        stderr: expect.not.stringMatching(/error|\bTS\d+:/),
        exitCode: 0,
      });
      const compiled = await run([join(app, isWindows ? "program.exe" : "program")], app);
      expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
      const fromSource = await run(runFromSourceCommand, app);
      expect({ stdout: fromSource.stdout, exitCode: fromSource.exitCode }).toEqual({
        stdout: plain.stdout,
        exitCode: 0,
      });
    },
    120_000,
  );
}

for (const [what, [specifier, program, nearest]] of Object.entries(leftToTheProgram)) {
  test(`a type import that only the program's tsconfig.json resolves is found: ${what}`, async () => {
    using dir = tempDir("another-tsconfig-unresolved", typeImport(specifier, program, nearest));
    const app = join(String(dir), "app");
    expect(await run([bunExe(), "run", "main.ts"], app)).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
    const built = await run(buildCommand, app);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: expect.not.stringMatching(/error|\bTS\d+:/),
      exitCode: 0,
    });
    const compiled = await run([join(app, isWindows ? "program.exe" : "program")], app);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "2\n", exitCode: 0 });
    const fromSource = await run(runFromSourceCommand, app);
    expect({ stdout: fromSource.stdout, exitCode: fromSource.exitCode }).toEqual({ stdout: "2\n", exitCode: 0 });
  }, 120_000);
}

test("a type error against the file that the other package's alias names is an error", async () => {
  using dir = tempDir("another-tsconfig-error", {
    ...accepted["the same alias in both packages"],
    "lib/index.ts": `import { twice, make } from "@/util";\nexport function four(): number { return twice("two"); }\nexport function shape() { return make(); }\n`,
  });
  const built = await run(buildCommand, join(String(dir), "app"));
  expect(built.stderr).toContain("TS2345");
  expect(built.exitCode).toBe(1);
}, 120_000);
