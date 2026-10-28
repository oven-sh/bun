import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const tsconfig = JSON.stringify({
  compilerOptions: {
    lib: ["ESNext"],
    target: "ESNext",
    module: "Preserve",
    moduleResolution: "bundler",
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
});

async function run(cmd: string[], files: Record<string, string>) {
  using dir = tempDir("aot-explain-reasons", { "tsconfig.json": tsconfig, ...files });
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), ...cmd], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return { stdout, stderr, exitCode, wroteExecutable: existsSync(join(String(dir), isWindows ? "app.exe" : "app")) };
}

const build = (files: Record<string, string>) =>
  run(["build", "--compile", "--aot", "main.ts", "--outfile", "app"], files);

describe.concurrent("packages", () => {
  const withTypeError = {
    "main.ts": 'import { thrice } from "typed";\nexport const nine = thrice(3);\n',
    "node_modules/typed/package.json": '{ "name": "typed", "version": "1.0.0", "main": "index.ts" }',
    "node_modules/typed/index.ts":
      "export function thrice(n: number): number { const text: string = n; return n * 3; }\n",
  };
  const typed = {
    ...withTypeError,
    "node_modules/typed/index.ts": "export function thrice(n: number): number { return n * 3; }\n",
  };

  test("a package with a type error is compiled without its types, with a warning, in bun check --aot as in a build", async () => {
    const checked = await run(["check", "--aot", "--no-pretty", "main.ts"], withTypeError);
    expect(checked.stdout.replaceAll("\\", "/")).toMatch(
      /^warning TS100009: 'typed' has 1 type error \(the first at .*node_modules\/typed\/index\.ts:1:51\).*\n  node_modules\/typed\/index\.ts\(1,51\): TS2322: Type 'number' is not assignable to type 'string'\.$/m,
    );
    expect(checked.exitCode).toBe(0);
    const { stderr, exitCode, wroteExecutable } = await build(withTypeError);
    expect(stderr.replaceAll("\\", "/")).toMatch(
      /^warn: TS100009: 'typed' has 1 type error \(the first at .*node_modules\/typed\/index\.ts:1:51\)/m,
    );
    expect({ exitCode, wroteExecutable }).toEqual({ exitCode: 0, wroteExecutable: true });
  }, 120_000);

  test("a package without type errors gets no warning", async () => {
    const { stdout, stderr, exitCode } = await run(["check", "--aot", "--no-pretty", "main.ts"], typed);
    expect({ warned: (stdout + stderr).includes("TS100009"), exitCode }).toEqual({ warned: false, exitCode: 0 });
  }, 60_000);
});
