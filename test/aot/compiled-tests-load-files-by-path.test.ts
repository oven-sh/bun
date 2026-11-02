// A test suite loads files that no build can know: a module that a test has just written, a fixture named by the environment.
// `bun test --aot` refuses such a file as an executable does, with an error that says what to do in a test run, and loads it with
// --aot-allow-code-from-disk. It prints no warning at an import whose path is not a constant: most of them find a compiled file.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      target: "ESNext",
      module: "Preserve",
      noEmit: true,
      typeRoots: [join(import.meta.dir, "..", "..", "packages")],
      types: ["bun-types"],
    },
  }),
  "suite/compiled.ts": `export const compiled: string = "compiled with the suite";`,
  "suite/loads.test.ts": `
    import { expect, test } from "bun:test";
    import { compiled } from "./compiled";

    const named = (key: string): string => process.env[key] ?? "";

    test("a module that the test writes", async () => {
      const folder = named("WRITTEN");
      await Bun.write(folder + "/written.ts", "export const written: number = 6 * 7;");
      await Bun.write(folder + "/written.cjs", "module.exports = { written: 'by require' };");
      expect(((await import(folder + "/written.ts")) as { written: number }).written).toBe(42);
      expect((require(folder + "/written.cjs") as { written: string }).written).toBe("by require");
    });
    test("a fixture that the environment names", async () => {
      expect(((await import(named("FIXTURE"))) as { fixture: string }).fixture).toBe("outside the suite");
    });
    test("a compiled file under a computed path", async () => {
      expect(((await import("./" + named("COMPILED") + ".ts")) as { compiled: string }).compiled).toBe(compiled);
    });
    test("a file that does not exist", async () => {
      expect(import(named("WRITTEN") + "/nothing.ts")).rejects.toThrow("Cannot find module");
    });
  `,
  "elsewhere/fixture.ts": `export const fixture: string = "outside the suite";`,
};

async function runSuite(...flags: string[]) {
  using dir = tempDir("compiled-tests-load-files-by-path", files);
  const env = {
    ...bunEnv,
    FIXTURE: join(String(dir), "elsewhere", "fixture.ts"),
    WRITTEN: join(String(dir), "written"),
    COMPILED: "compiled",
  };
  return await run([bunExe(), "test", "--aot", ...flags], join(String(dir), "suite"), env);
}
const results = (said: string) =>
  [...said.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]}: ${match[2]}`);

test("a file that was not compiled loads, as under plain bun test", async () => {
  const { stderr, exitCode } = await runSuite();
  expect(stderr).not.toContain("TS100064");
  expect(results(stderr)).toEqual([
    "pass: a module that the test writes",
    "pass: a fixture that the environment names",
    "pass: a compiled file under a computed path",
    "pass: a file that does not exist",
  ]);
  expect(exitCode).toBe(0);
});

test("with --aot-allow-code-from-disk it loads", async () => {
  const { stderr, exitCode } = await runSuite("--aot-allow-code-from-disk");
  expect(stderr).not.toContain("TS100064");
  expect(results(stderr)).toEqual([
    "pass: a module that the test writes",
    "pass: a fixture that the environment names",
    "pass: a compiled file under a computed path",
    "pass: a file that does not exist",
  ]);
  expect(exitCode).toBe(0);
});

test("the flag needs --aot", async () => {
  using dir = tempDir("compiled-tests-load-files-by-path", files);
  const { stderr, exitCode } = await run([bunExe(), "test", "--aot-allow-code-from-disk"], join(String(dir), "suite"));
  expect(stderr).toContain("error: --aot-allow-code-from-disk requires --aot");
  expect(exitCode).toBe(1);
});
