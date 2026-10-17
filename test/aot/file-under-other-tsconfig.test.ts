import { expect } from "bun:test";
import { test } from "./supported";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

// In a repository of several packages each has a tsconfig.json of its own, and often the same alias in it. Bun resolves the imports
// of a file by the `paths` of the tsconfig.json nearest to that file. What is compiled is checked against the file that runs.
// An `import type` is erased before Bun resolves anything: a name that the nearest tsconfig.json does not know is looked for by that
// of the program, as `tsc` does for every file of a program.

const options = `"strict": true, "target": "ESNext", "module": "Preserve", "noEmit": true, "types": []`;
const declared = `declare const console: { log(...values: unknown[]): void };\n`;

const packages = {
  "an alias that only the other package has": {
    "app/tsconfig.json": `{ "compilerOptions": { ${options} } }`,
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
    "app/tsconfig.json": `{ "compilerOptions": { ${options} } }`,
    "app/main.ts": `${declared}import { all } from "../lib/index";\nconsole.log(all());\n`,
    "lib/tsconfig.json": `{ "compilerOptions": { ${options}, "baseUrl": "./src" } }`,
    "lib/index.ts": `import { one } from "deep/one";\nimport { two } from "two.mjs";\nexport function all(): string { return one() + two(); }\n`,
    "lib/src/deep/one.ts": `export function one(): string { return "one"; }\n`,
    "lib/src/two.mts": `export function two(): string { return "two"; }\n`,
  },
};

const api = `export interface Settings { n: number }\n`;
const typeOnly = `import type { Settings } from "the-app";\nexport function next(settings: Settings): number { return settings.n + 1; }\n`;
const nested = {
  "app/tsconfig.json": `{ "compilerOptions": { ${options}, "paths": { "the-app": ["./src/api.ts"] } } }`,
  "app/main.ts": `${declared}import { next } from "./mods/one/index";\nconsole.log(next({ n: 1 }));\n`,
  "app/src/api.ts": api,
  "app/mods/one/index.ts": typeOnly,
};
Object.assign(packages, {
  "a type imported by a name that only the program's tsconfig.json knows: the nearest has no paths": {
    ...nested,
    "app/mods/tsconfig.json": `{ "compilerOptions": { ${options} } }`,
  },
  "a type imported by a name that only the program's tsconfig.json knows: the nearest has other paths": {
    ...nested,
    "app/mods/tsconfig.json": `{ "compilerOptions": { ${options}, "paths": { "helpers/*": ["./helpers/*"] } } }`,
  },
  "a type imported by a name that only the program's tsconfig.json knows: the nearest extends it and has paths of its own": {
    ...nested,
    "app/mods/tsconfig.json": `{ "extends": "../tsconfig.json", "compilerOptions": { "paths": { "helpers/*": ["./helpers/*"] } } }`,
  },
  "a type imported by a name that only the program's tsconfig.json knows: the nearest has a baseUrl": {
    ...nested,
    "app/mods/tsconfig.json": `{ "compilerOptions": { ${options}, "baseUrl": "." } }`,
  },
  "a type imported from the program's baseUrl under a tsconfig.json without one": {
    ...nested,
    "app/tsconfig.json": `{ "compilerOptions": { ${options}, "baseUrl": "./src" } }`,
    "app/mods/tsconfig.json": `{ "compilerOptions": { ${options} } }`,
    "app/mods/one/index.ts": typeOnly.replace("the-app", "api"),
  },
});

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({ cmd, cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

for (const [what, files] of Object.entries(packages)) {
  test(what, async () => {
    using dir = tempDir("another-tsconfig", files);
    const app = join(String(dir), "app");
    const plain = await run([bunExe(), "run", "main.ts"], app);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const build = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "program"], app);
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.not.stringContaining("error"), exitCode: 0 });
    const compiled = await run([join(app, "program")], app);
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
    const mode = await run([bunExe(), "run", "--aot", "main.ts"], app);
    expect({ stdout: mode.stdout, exitCode: mode.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);
}

test("a type error against the file that the other package's alias names is an error", async () => {
  using dir = tempDir("another-tsconfig-error", {
    ...packages["the same alias in both packages"],
    "lib/index.ts": `import { twice, make } from "@/util";\nexport function four(): number { return twice("two"); }\nexport function shape() { return make(); }\n`,
  });
  const build = await run([bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "program"], join(String(dir), "app"));
  expect(build.stderr).toContain("TS2345");
  expect(build.exitCode).toBe(1);
}, 120_000);
