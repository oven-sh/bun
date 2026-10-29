import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

async function buildAndRun(name: string, lib: string[] | undefined, main: string, dependency: string) {
  using directory = tempDir(name, {
    "package.json": JSON.stringify({ name: "app" }),
    "tsconfig.json": JSON.stringify({
      compilerOptions: {
        target: "esnext",
        lib,
        module: "preserve",
        moduleResolution: "bundler",
        types: [],
        strict: true,
      },
    }),
    "main.ts": `${main}\ndeclare const console: { log(...values: unknown[]): void };\n`,
    "node_modules/ships-typescript/package.json": JSON.stringify({
      name: "ships-typescript",
      main: "index.ts",
      types: "index.ts",
    }),
    "node_modules/ships-typescript/index.ts": dependency,
  });
  const outfile = join(String(directory), "out" + (isWindows ? ".exe" : ""));
  const { stderr, exitCode } = await run(
    [bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", outfile],
    String(directory),
  );
  if (exitCode) return { stderr, exitCode, stdout: "" };
  const { stdout } = await run([outfile], String(directory));
  return { stderr, exitCode, stdout };
}

test("a circular auto-accessor in a dependency demotes the dependency instead of stopping the build", async () => {
  const { stderr, exitCode, stdout } = await buildAndRun(
    "aot-dependency-accessor-cycle",
    undefined,
    `import { Held } from "ships-typescript";\nconsole.log(new Held().size);`,
    `export class Held { accessor value: Held["value"] = 1 as any; size = 2; }\n`,
  );
  expect(stderr).toContain("TS100010");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "2\n" });
}, 120_000);

test("mismatched type parameters on an unnamed default class in a dependency demote the dependency instead of stopping the build", async () => {
  const { stderr, exitCode, stdout } = await buildAndRun(
    "aot-dependency-unnamed-class",
    undefined,
    `import Box from "ships-typescript";\nconsole.log(new Box().size);`,
    `export default class<T> { size = 2; held?: T; }\nexport default interface Named<U> { other?: U; }\n`,
  );
  expect(stderr).toContain("TS100010");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "2\n" });
}, 120_000);
