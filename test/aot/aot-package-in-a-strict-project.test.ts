import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { join } from "path";
import { slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildTimeout = 300_000;

function project(main: string) {
  return tempDirWithBunTypes("aot-package-strict-project", {
    "main.ts": main,
    "tsconfig.json": JSON.stringify({
      compilerOptions: { module: "preserve", moduleResolution: "bundler", strict: true, noEmit: true },
    }),
    "node_modules/adder/package.json": JSON.stringify({
      name: "adder",
      version: "1.0.0",
      type: "module",
      exports: { ".": { aot: "./index.aot.ts", default: "./index.js" } },
    }),
    "node_modules/adder/index.js": "export function add(a, b) {\n  return a + b;\n}\n",
    "node_modules/adder/index.aot.ts": "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  });
}

const codesOf = (said: string) => said.split("\n").flatMap(line => /\berror:? (TS\d+): /.exec(line)?.[1] ?? []);

async function build(folder: string) {
  const command = [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "app"];
  const { stderr, exitCode, signal } = await spawned(command, folder, env);
  return { errors: codesOf(stderr), exitCode, signal };
}

async function check(folder: string, ...flags: string[]) {
  const { stdout, stderr, exitCode, signal } = await spawned([bunExe(), "check", ...flags, "main.ts"], folder, env);
  return { errors: codesOf(stdout + stderr), exitCode, signal };
}

describe('a package with an "aot" condition and no declarations, in a strict project', () => {
  test(
    "the importer needs no declaration file",
    () =>
      slot(async () => {
        using dir = project(`import { add } from "adder";\nconsole.log(add(1, 2));\n`);
        expect(await build(String(dir))).toEqual({ errors: [], exitCode: 0, signal: null });
        const { stdout, exitCode } = await spawned(
          [join(String(dir), isWindows ? "app.exe" : "app")],
          String(dir),
          bunEnv,
        );
        expect({ stdout, exitCode }).toEqual({ stdout: "3\n", exitCode: 0 });
        expect(await check(String(dir), "--aot")).toEqual({ errors: [], exitCode: 0, signal: null });
      }),
    buildTimeout,
  );

  test(
    "the importer is checked against its types",
    () =>
      slot(async () => {
        using dir = project(`import { add } from "adder";\nconsole.log(add(1, "2"));\n`);
        expect(await build(String(dir))).toEqual({ errors: ["TS2345"], exitCode: 1, signal: null });
        expect(await check(String(dir), "--aot")).toEqual({ errors: ["TS2345"], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );

  test(
    "bun check without --aot does not read the file",
    () =>
      slot(async () => {
        using dir = project(`import { add } from "adder";\nconsole.log(add(1, 2));\n`);
        expect(await check(String(dir))).toEqual({ errors: ["TS7016"], exitCode: 1, signal: null });
      }),
    buildTimeout,
  );
});
