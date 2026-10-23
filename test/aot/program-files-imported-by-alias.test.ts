import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function build(directory: string, entryPoint: string) {
  const outfile = join(directory, "out" + (isWindows ? ".exe" : ""));
  const { stderr: said, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", entryPoint, "--outfile", outfile],
    directory,
  );
  return { said, exitCode };
}

const manifest = (more: object = {}) => JSON.stringify({ name: "app", version: "1.0.0", type: "module", ...more });
const subpathImports = manifest({ imports: { "#lib/*": "./lib/*" } });
const wrongReturnType = `export function f(): number {\n  return "x";\n}\n`;
const ambient = `declare const console: { log(...values: unknown[]): void };\ndeclare function require(name: string): any;\n`;
const paths = JSON.stringify({
  files: [],
  compilerOptions: {
    module: "preserve",
    moduleResolution: "bundler",
    allowImportingTsExtensions: true,
    noEmit: true,
    types: [],
    paths: { "@lib/*": ["./lib/*"] },
  },
});

test.each([
  [
    "a subpath import in a JavaScript file",
    "./main.js",
    { "package.json": subpathImports, "main.js": `import { f } from "#lib/f.ts";\nconsole.log(f());\n` },
  ],
  [
    "require() of a subpath import in a TypeScript file",
    "./main.ts",
    { "package.json": subpathImports, "main.ts": `${ambient}const { f } = require("#lib/f.ts");\nconsole.log(f());\n` },
  ],
  [
    "a tsconfig paths alias in a JavaScript file",
    "./main.js",
    {
      "package.json": manifest(),
      "tsconfig.json": paths,
      "main.js": `import { f } from "@lib/f.ts";\nconsole.log(f());\n`,
    },
  ],
])(
  "a type error in the program's own TypeScript file fails the build when the file is reached through %s",
  async (_, entryPoint, files) => {
    using dir = tempDir("aot-own-file-by-alias", { ...files, "lib/f.ts": wrongReturnType });
    const { said, exitCode } = await build(String(dir), entryPoint);
    expect(said).toContain("error: TS2322");
    expect(said).not.toContain("TS100009");
    expect(exitCode).not.toBe(0);
  },
  120_000,
);

test("an undeclared name in the program's own TypeScript file fails the build when the file is reached through a subpath import", async () => {
  using dir = tempDir("aot-own-file-by-alias-undeclared-name", {
    "package.json": subpathImports,
    "main.js": `import { f } from "#lib/f.ts";\nconsole.log(f());\n`,
    "lib/f.ts": `export function f(): number {\n  return typeof missing === "undefined" ? 1 : 2;\n}\n`,
  });
  const { said, exitCode } = await build(String(dir), "./main.js");
  expect(said).toContain("error: TS2304");
  expect(exitCode).not.toBe(0);
}, 120_000);

test("a subpath import that maps to an installed package is still a dependency", async () => {
  using dir = tempDir("aot-subpath-import-of-a-package", {
    "package.json": manifest({ imports: { "#dep": "dep" } }),
    "main.js": `import { f } from "#dep";\nconsole.log(f());\n`,
    "node_modules/dep/package.json": JSON.stringify({
      name: "dep",
      version: "1.0.0",
      type: "module",
      exports: "./index.ts",
    }),
    "node_modules/dep/index.ts": wrongReturnType,
  });
  const { said, exitCode } = await build(String(dir), "./main.js");
  expect(said).toContain("TS100009");
  expect(exitCode).toBe(0);
}, 120_000);
