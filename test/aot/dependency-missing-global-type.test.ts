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

test("a dependency that needs a global type missing from the application's lib does not stop the build", async () => {
  const { stderr, exitCode, stdout } = await buildAndRun(
    "aot-dependency-missing-global-type",
    ["es2017"],
    `import { first } from "ships-typescript";\nfirst().then(value => console.log(value));`,
    `async function* numbers() { yield 2; }\nexport async function first() { return (await numbers().next()).value; }\n`,
  );
  expect(stderr).not.toContain("TS2318");
  expect({ exitCode, stdout }).toEqual({ exitCode: 0, stdout: "2\n" });
}, 120_000);
