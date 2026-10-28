// generated/run-generated.ts builds the programs that are only compiled many to an executable. Each is still judged by itself: the one that departs from plain Bun fails and no other
// does, the one that TypeScript rejects takes no other with it, and with an executable for each program the verdicts are the same.
import { expect } from "bun:test";
import { writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { join } from "path";
import { test } from "./supported";

async function run(env: Record<string, string>) {
  using folder = tempDir("aot-shared-executables", {});
  const file = join(String(folder), "family.test.ts");
  writeFileSync(file, `import ${JSON.stringify(join(import.meta.dir, "generated", "eight-small-programs.ts"))};\n`);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", file],
    cwd: join(import.meta.dir, ".."),
    env: {
      ...bunEnv,
      AOT_TAKES: undefined,
      AOT_SHARE: undefined,
      AOT_PROGRAMS: undefined,
      AOT_GENERATED: "all",
      ...env,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const said = stdout + stderr;
  return {
    built: /^BUILT: .*$/m.exec(said)?.[0],
    failed: [...new Set(said.match(/^\(fail\) .*(?= \[)/gm))],
    counts: said.match(/^ *\d+ (?:pass|fail)$/gm)?.map(line => line.trim()),
  };
}

const verdicts = {
  failed: ["(fail) compile/aot/generated/eight small programs > program 6"],
  counts: ["7 pass", "1 fail"],
};

// Such a Bun builds each program alone.
test.skipIf(isASAN || isDebug)(
  "each program of an executable is judged by itself",
  async () => {
    expect(await run({})).toEqual({ built: "BUILT: 1 executables for 8 programs", ...verdicts });
  },
  300_000,
);

test("an executable for each program gives the same verdicts", async () => {
  expect(await run({ AOT_GENERATED_IN_ONE_EXECUTABLE: "1" })).toEqual({
    built: "BUILT: 7 executables for 8 programs",
    ...verdicts,
  });
}, 300_000);
