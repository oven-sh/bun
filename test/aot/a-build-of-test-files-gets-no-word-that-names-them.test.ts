import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { expectLayers } from "./harness/layers";
import { reportsToTheRunnerAlone } from "./harness/without-core-dump";
import { test } from "./supported";

// Over layers every program is built by a process of its own, which is handed its files through a descriptor.

const names = Array.from({ length: 20 }, (_, index) => `tests/t${index}.test.ts`);
const project = () =>
  tempDir("aot-a-build-of-test-files-gets-no-word-that-names-them", {
    "package.json": `{ "name": "many-test-files" }`,
    "shared.ts": `export const twice = (n: number) => n * 2;\n`,
    "setup.ts": `(globalThis as any).timesSetUp = ((globalThis as any).timesSetUp ?? 0) + 1;\n`,
    "list.txt": names.join("\n") + "\n",
    ...Object.fromEntries(
      names.map((name, index) => [
        name,
        `import { expect, test } from "bun:test";
import { twice } from "../shared";
test("t${index}", () => expect(twice(${index})).toBe(${2 * index}));
`,
      ]),
    ),
    "tests/set-up.test.ts": `import { expect, test } from "bun:test";
test("the file named by --preload has run", () => expect((globalThis as any).timesSetUp).toBe(1));
`,
  });
const env = reportsToTheRunnerAlone({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2" });

// The command is started as it is: with words in front of it, it would not be the longest that the system starts.
async function seen(cmd: string[], cwd: string, stdin?: string) {
  await using proc = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: stdin ? Bun.file(stdin) : "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (cmd.includes("--aot")) expectLayers(stderr);
  return {
    errors: stderr.split("\n").filter(line => /^error|^E2BIG|^SpawnFailed|^panic/.test(line)),
    passed: stderr.match(/^ *(\d+) pass$/m)?.[1],
    failed: stderr.match(/^ *(\d+) fail$/m)?.[1],
    exitCode,
  };
}

test.skipIf(isWindows).each([[["--files-from=/dev/stdin"]], [["--files-from", "/dev/stdin"]]])(
  "a list that is the stdin of the command is read once: %j",
  async flag => {
    using dir = project();
    const seenWith = (...flags: string[]) =>
      seen([bunExe(), "test", ...flags, "--parallel=2", ...flag], String(dir), join(String(dir), "list.txt"));
    const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
    expect(plain).toMatchObject({ errors: [], passed: "20", failed: "0", exitCode: 0 });
    expect(compiled).toEqual(plain);
  },
);

test("the value of a flag stays where a path of the same text is typed too", async () => {
  using dir = project();
  const seenWith = (...flags: string[]) =>
    seen(
      // With the first "./setup.ts" gone, the flag behind it would be the file to load.
      [bunExe(), "test", ...flags, "./tests/set-up.test.ts", "--preload", "./setup.ts", "--parallel=2", "./setup.ts"],
      String(dir),
    );
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain).toMatchObject({ errors: [], passed: "1", failed: "0" });
  expect(compiled).toEqual(plain);
});

test.skipIf(!isLinux)("the longest command line that the system starts", async () => {
  using dir = project();
  const files = names.map(name => "./" + name);
  // Paths that lead nowhere, which `bun test` passes over beside others. As many words whatever they add up to: the system counts those too.
  const padding = (bytes: number) =>
    Array.from({ length: 64 }, (_, index) => "./" + Buffer.alloc(Math.floor((bytes + index) / 64), "x").toString());
  // As many words, of as many bytes, as in front of the files below.
  const starts = (bytes: number) => {
    try {
      const cmd = [bunExe(), "--version", "--aot", "xxxxxxx", ...files, ...padding(bytes)];
      return Bun.spawnSync({ cmd, cwd: String(dir), env, stdio: ["ignore", "ignore", "ignore"] }).success;
    } catch {
      return false;
    }
  };
  let [most, tooMany] = [64 * 1024, 64 * 128 * 1024];
  expect(starts(most)).toBe(true);
  expect(starts(tooMany)).toBe(false);
  while (tooMany - most > 1) {
    const middle = Math.floor((most + tooMany) / 2);
    if (starts(middle)) most = middle;
    else tooMany = middle;
  }
  const compiled = await seen([bunExe(), "test", "--aot", "--parallel=2", ...files, ...padding(most)], String(dir));
  expect(compiled).toMatchObject({ errors: [], passed: "20", failed: "0", exitCode: 0 });
});
