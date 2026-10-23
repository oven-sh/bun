// Bugs in Bun without --aot that the programs under ./programs have found. The correct output of such a program is stored in
// its .expected.txt, so that --aot is still tested with it; this file checks plain `bun run` against the same output.
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe } from "harness";
import { join } from "path";

async function plain(program: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "main.js"],
    cwd: join(import.meta.dir, "programs", program),
    env: { ...bunEnv, ...env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout, exitCode };
}

// The optimizing JIT tiers skip the write-back of the sorted items, or the checks that go with it: in about one run in four,
// and in every run when the JIT compiles on the main thread, which is why that run comes first. Without the JIT the output is
// correct. Once the bug is fixed this test fails: change `test.failing` to `test`.
test.failing(
  "Array.prototype.sort writes every sorted item back although the comparator has changed the array in its last comparison",
  async () => {
    const program = "arrays/sort-write-back-after-mutation";
    const correct = {
      stdout: readFileSync(join(import.meta.dir, "programs", program + ".expected.txt"), "utf8"),
      exitCode: 0,
    };
    const runs = await Promise.all([
      plain(program, { BUN_JSC_useConcurrentJIT: "0" }),
      ...Array.from({ length: 10 }, () => plain(program)),
    ]);
    for (const run of runs) expect(run).toEqual(correct);
  },
  120_000,
);

// Function.prototype.apply is written with the engine's call of a list, which reads the list before it looks at the callee.
// Once the bug is fixed this test fails: change `test.failing` to `test`.
test.failing(
  "Function.prototype.apply throws for a receiver that is no function before it reads the list",
  async () => {
    const program = "calls/apply-tests-the-callee-before-the-list";
    const correct = {
      stdout: readFileSync(join(import.meta.dir, "programs", program + ".expected.txt"), "utf8"),
      exitCode: 0,
    };
    expect(await plain(program)).toEqual(correct);
  },
);
