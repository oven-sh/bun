import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const options = { target: "ESNext", module: "ESNext", moduleResolution: "bundler", types: [] as string[], strict: true, outDir: "dist" };

async function run(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({ cmd: [bunExe(), ...args], cwd, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { said: stdout + stderr, exitCode };
}

const passed = (said: string) => [...said.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]).sort();
const errors = (said: string) => [...said.matchAll(/^(\S+)\((\d+),\d+\): error (TS\d+)/gm)].map(match => `${match[1]}:${match[2]} ${match[3]}`).sort();

const files = {
  "tsconfig.json": JSON.stringify({ compilerOptions: options, include: ["src"] }),
  "src/value.ts": `export const value: number = 1;\n`,
  "main.ts": `import { value } from "./src/value.ts";\nconsole.log(value);\n`,
  "test/tsconfig.json": JSON.stringify({ compilerOptions: options }),
  "test/value.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "../src/value.ts";\ntest("value", () => {\n  expect(value).toBe(1);\n});\n`,
  "test/wrong.test.ts": `import { expect, test } from "bun:test";\nimport { value } from "../src/value.ts";\nconst text: string = value;\ntest("never runs", () => {\n  expect(typeof text).toBe("number");\n});\n`,
};

test("an import path that ends in .ts needs no allowImportingTsExtensions under --aot: Bun finds the file", async () => {
  using dir = tempDir("import-paths-that-end-in-ts", files);
  const tested = await run(String(dir), "test", "--aot");
  expect(errors(tested.said)).toEqual(["test/wrong.test.ts:3 TS2322"]);
  expect(passed(tested.said)).toEqual(["value"]);
  const checked = await run(String(dir), "check", "--aot", "main.ts");
  expect(errors(checked.said)).toEqual([]);
  expect(checked.exitCode).toBe(0);
}, 60_000);

test("bun check without --aot reports it as tsc does", async () => {
  using dir = tempDir("import-paths-that-end-in-ts", files);
  const { said, exitCode } = await run(String(dir), "check", "main.ts");
  expect(errors(said)).toEqual(["main.ts:1 TS5097"]);
  expect(exitCode).toBe(1);
});
