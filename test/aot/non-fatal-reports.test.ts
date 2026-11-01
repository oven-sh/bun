import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

async function run(files: Record<string, string>) {
  using dir = tempDir("aot-reports", files);
  const { stdout, stderr, exitCode } = await runCommand([bunExe(), "--debug-aot", "main.ts"], String(dir));
  return { stdout, stderr, exitCode };
}

test("an unused @ts-expect-error is a warning", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.ts": `// @ts-expect-error nothing is wrong on the next line\nconst n: number = 1;\nconsole.log(n);\n`,
  });
  expect(stderr).toContain("TS2578");
  expect({ stdout, exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
});

test(`a package under "types" that is not installed is a warning`, async () => {
  const { stdout, stderr, exitCode } = await run({
    "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: ["not-installed"] } }),
    "main.ts": `console.log(typeof Bun.version);\n`,
  });
  expect(stderr).toContain("TS2688");
  expect({ stdout, exitCode }).toEqual({ stdout: "string\n", exitCode: 0 });
});

test(`types: ["bun-types"] without the package installed is served by the copy that Bun carries`, async () => {
  expect(
    await run({
      "tsconfig.json": JSON.stringify({ compilerOptions: { strict: true, types: ["bun-types"] } }),
      "main.ts": `const version: string = Bun.version;\nconsole.log(typeof version);\n`,
    }),
  ).toEqual({ stdout: "string\n", stderr: "", exitCode: 0 });
});

test("a type error in the program's own code still stops the build", async () => {
  const { stdout, stderr, exitCode } = await run({
    "main.ts": `const n: number = "one";\nconsole.log(n);\n`,
  });
  expect(stderr).toContain("TS2322");
  expect(stdout).toBe("");
  expect(exitCode).not.toBe(0);
});
