import { expect } from "bun:test";
import { symlinkSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// A package of the workspace has a tsconfig.json of its own with other options, so it is checked by itself. A file of the application that nothing imports, but that the root's
// tsconfig.json includes, merges a declaration of its own into what the package exports: `declare module "pkg" { interface Builder {} }`, as @orpc/openapi does to @orpc/contract.
const options = `"strict": true, "module": "esnext", "moduleResolution": "bundler", "noEmit": true`;
const shared = {
  "tsconfig.json": `{ "compilerOptions": { ${options}, "target": "esnext" }, "include": ["*"] }`,
  "packages/pkg/tsconfig.json": `{ "compilerOptions": { ${options}, "target": "es2020", "lib": ["ES2022", "DOM"] }, "include": ["src"] }`,
  "packages/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "type": "module", "exports": { ".": "./src/index.ts" } }`,
};
const keys = `const m = require("pkg"); console.log(Object.keys(m).sort().join());`;

const projects: Record<string, Record<string, string>> = {
  "a class behind a star": {
    "packages/pkg/src/index.ts": `export * from "./builder";`,
    "packages/pkg/src/builder.ts": `export class Builder<T> { static create() { return new Builder<{}>(); } a() { return 1; } }\nexport const made = Builder.create();`,
    "augment.ts": `declare module "pkg" { interface Builder<T> { route(meta: number): number } }\nexport {};`,
    "entry.cjs": `${keys} console.log(m.made.a(), m.made instanceof m.Builder);`,
  },
  "a class that the index declares": {
    "packages/pkg/src/index.ts": `export class Builder { #secret = 2; static count = 0; a() { Builder.count++; return this.#secret; } }\nexport const made = new Builder();`,
    "augment.ts": `declare module "pkg" { interface Builder { route(): number } }\nexport {};`,
    "entry.cjs": `${keys} console.log(m.made.a(), m.Builder.count);`,
  },
  "a class under another name": {
    "packages/pkg/src/index.ts": `export { Inner as Builder, made } from "./builder";`,
    "packages/pkg/src/builder.ts": `export class Inner { a() { return 3; } }\nexport const made = new Inner();`,
    "augment.ts": `declare module "pkg" { interface Builder { route(): number } }\nexport {};`,
    "entry.cjs": `${keys} console.log(m.made.a(), m.Builder.name);`,
  },
  "a function and a namespace": {
    "packages/pkg/src/index.ts": `export * from "./helper";`,
    "packages/pkg/src/helper.ts": `export function helper() { return 4; }\nexport const other = helper();`,
    "augment.ts": `declare module "pkg" { namespace helper { let extra: number } }\nexport {};`,
    "entry.cjs": `${keys} console.log(m.helper(), m.other);`,
  },
  "an enum": {
    "packages/pkg/src/index.ts": `export * from "./colors";`,
    "packages/pkg/src/colors.ts": `export enum Color { Red, Green }\nexport const first = Color.Red;`,
    "augment.ts": `declare module "pkg" { namespace Color { let extra: number } }\nexport {};`,
    "entry.cjs": `${keys} console.log(m.Color.Green, m.first);`,
  },
  "the augmentation is imported and stores a method": {
    "packages/pkg/src/index.ts": `export * from "./builder";`,
    "packages/pkg/src/builder.ts": `export class Builder { a() { return 5; } }\nexport const made = new Builder();`,
    "augment.ts": `import { Builder } from "pkg";\ndeclare module "pkg" { interface Builder { route(): number } }\nBuilder.prototype.route = function () { return this.a() + 1; };`,
    "entry.ts": `import "./augment";\nimport * as m from "pkg";\nconsole.log(Object.keys(m).sort().join(), m.made.route());`,
  },
  "a namespace import": {
    "packages/pkg/src/index.ts": `export * from "./builder";`,
    "packages/pkg/src/builder.ts": `export class Builder { a() { return 6; } }\nexport const made = new Builder();`,
    "augment.ts": `declare module "pkg" { interface Builder { route(): number } }\nexport {};`,
    "entry.ts": `import * as m from "pkg";\nconst all: Record<string, unknown> = m;\nconsole.log(Object.keys(all).sort().join(), m.made.a());`,
  },
  "a global of the application's": {
    "packages/pkg/src/index.ts": `export class Builder { list = [1, 2]; a() { return this.list.length; } }\nexport const made = new Builder();`,
    "augment.ts": `declare global { interface Array<T> { route(): number } }\ndeclare module "pkg" { interface Builder { route(): number } }\nexport {};`,
    "entry.cjs": `${keys} console.log(m.made.a());`,
  },
};

for (const [title, files] of Object.entries(projects)) {
  test.concurrent(title, async () => {
    using dir = tempDir("aot-augmented-package", { ...shared, ...files, "node_modules/.keep": "" });
    symlinkSync(`${dir}/packages/pkg`, `${dir}/node_modules/pkg`, "junction");
    const entry = "entry.cjs" in files ? "entry.cjs" : "entry.ts";
    const plain = await run([bunExe(), entry], String(dir), bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", entry, "--outfile", "compiled"],
      String(dir),
      bunEnv,
    );
    expect(build.stderr).not.toContain("error");
    const compiled = await run([`${dir}/compiled`], String(dir), bunEnv);
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
    });
  });
}

test("a test run", async () => {
  const files = projects["a class behind a star"];
  using dir = tempDir("aot-augmented-package", {
    ...shared,
    ...files,
    "node_modules/.keep": "",
    "uses.test.ts": `import { test, expect } from "bun:test";\nimport * as m from "pkg";\ntest("keys", () => { const all: Record<string, unknown> = m; expect(Object.keys(all).sort().join()).toBe("Builder,made"); expect(m.made.a()).toBe(1); });`,
  });
  symlinkSync(`${dir}/packages/pkg`, `${dir}/node_modules/pkg`, "junction");
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(compiled.stderr).toContain("1 pass");
  expect(compiled.exitCode).toBe(0);
});
