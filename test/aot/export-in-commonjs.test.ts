// Under `module: "nodenext"` a .ts file beside a package.json without "type": "module" is CommonJS to TypeScript, and `verbatimModuleSyntax`
// refuses its `export` (TS1287). That is a type error. `bun run` takes the file for an ES module and runs it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const verbatim = JSON.stringify({
  compilerOptions: { strict: true, module: "nodenext", moduleResolution: "nodenext", verbatimModuleSyntax: true },
});
const pool = `export function getPool(): string { return "pool"; }\n`;

const forms: [string, string, string[]][] = [
  ["as the run is built by itself", "", []],
  ["one program", "TestRunLayers:0", []],
  ["three layers", "TestRunLayers:3", ["--isolate"]],
];

const projects: [string, Record<string, string>][] = [
  [
    "the project's own file",
    {
      "package.json": `{ "name": "own" }`,
      "tsconfig.json": verbatim,
      "src/pool.ts": pool,
      "src/consumer.ts": `import { getPool } from "./pool.js";\nexport const name = getPool();\n`,
      "tests/consumer.test.ts": `import { expect, test } from "bun:test";
import { name } from "../src/consumer.js";
test("uses the pool", () => { expect(name).toBe("pool"); });
`,
    },
  ],
  [
    "the file of a dependency that ships TypeScript",
    {
      "package.json": `{ "name": "uses-a-dependency", "type": "module" }`,
      "tsconfig.json": `{ "compilerOptions": { "strict": true } }`,
      "node_modules/pool/package.json": `{ "name": "pool", "version": "1.0.0", "main": "index.ts", "types": "index.ts" }`,
      "node_modules/pool/tsconfig.json": verbatim,
      "node_modules/pool/index.ts": pool,
      "main.ts": `import { getPool } from "pool";\nconsole.log(getPool());\n`,
      "tests/consumer.test.ts": `import { expect, test } from "bun:test";
import { getPool } from "pool";
test("uses the pool", () => { expect(getPool()).toBe("pool"); });
`,
    },
  ],
];

for (const [whose, files] of projects) {
  for (const [form, words, flags] of forms) {
    test.concurrent(`${whose} is compiled for a test run, ${form}`, async () => {
      using dir = tempDir("export-in-commonjs", files);
      await using run = Bun.spawn({
        cmd: [bunExe(), "test", "--aot", ...flags],
        env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words, BUN_JSC_logAOTPhaseTimes: "1" },
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
      expect(stderr.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
      expect(stderr).not.toContain("files left to the loader added");
      expect(stderr).toContain(" 1 pass");
      expect(exitCode).toBe(0);
    });
  }
}

test.concurrent("an executable is built over such a dependency", async () => {
  using dir = tempDir("export-in-commonjs", projects[1][1]);
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "main.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(buildErrors.split("\n").filter(line => line.startsWith("error"))).toEqual([]);
  expect(buildExitCode).toBe(0);
  await using run = Bun.spawn({ cmd: [join(String(dir), "out")], env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "pool\n", stderr: "", exitCode: 0 });
});

test.concurrent("in the program's own file it stops an executable's build, as every type error does", async () => {
  using dir = tempDir("export-in-commonjs", projects[0][1]);
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", "src/consumer.ts", "--outfile", "out"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(stderr).toContain("error: TS1287");
  expect(exitCode).toBe(1);
});
