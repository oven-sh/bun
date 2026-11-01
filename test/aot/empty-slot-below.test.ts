import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { reportsToTheRunnerAlone } from "./harness/without-core-dump";
import { test } from "./supported";

// What spawnSync() answers is a record that the library's layer makes. A type out of a declaration file is met by it through its names.

const project = () =>
  tempDir("aot-empty-slot-below", {
    "package.json": `{ "name": "reads-what-a-process-left" }`,
    "ended.d.ts": `interface Ended {
  pid: number;
  output: unknown[];
  stdout: unknown;
  stderr: unknown;
  status: number | null;
  signal: string | null;
  error?: Error;
}
`,
    "run.ts": `/// <reference path="./ended.d.ts" />
import { spawnSync } from "node:child_process";
export function ended(file: string): Ended {
  return spawnSync(file, ["--version"]) as Ended;
}
export function told(e: Ended): string {
  return \`\${e.status} \${e.signal} \${e.error === undefined ? "no error" : (e.error as Error & { code: string }).code}\`;
}
`,
    "run.test.ts": `import { expect, test } from "bun:test";
import { ended, told } from "./run";
test("a process that ran", () => expect(told(ended(process.execPath))).toBe("0 null no error"));
test("a process that never began", () => expect(told(ended("/no/such/file"))).toBe("null null ENOENT"));
`,
  });
const env = reportsToTheRunnerAlone({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" });

async function seen(cwd: string, ...flags: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "./run.test.ts"],
    cwd,
    env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (flags.includes("--aot")) expectLayers(stderr);
  return {
    errors: stderr.split("\n").filter(line => /^error|^panic/.test(line)),
    passed: stderr.match(/^ *(\d+) pass$/m)?.[1],
    failed: stderr.match(/^ *(\d+) fail$/m)?.[1],
    exitCode,
  };
}

test("the files of the project are built over the library's layer", async () => {
  using dir = project();
  const [plain, compiled] = await Promise.all([seen(String(dir)), seen(String(dir), "--aot")]);
  expect(plain).toMatchObject({ errors: [], passed: "2", failed: "0", exitCode: 0 });
  expect(compiled).toEqual(plain);
});
