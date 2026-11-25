// The native tests machine/random/* draw the same procedures on every run. Here `testaot fuzz-allocation` draws others each day:
// each procedure is compiled with the allocation checker on, run, and compared with what an interpreter answers.
import { expect } from "bun:test";
import { isASAN } from "harness";
import { without } from "../harness/capabilities";
import { test } from "../harness/default-timeout";
import { run, testaot } from "./testaot";

// What one day takes fits below seedsPerDay, so no two days share a seed. All of them lie far above the seeds of the native tests.
const seedsPerDay = 10_000;
const firstSeed = Math.floor(Date.now() / 86_400_000) * seedsPerDay;
const divisor = isASAN ? 4 : 1;
const ranges = [
  { blocks: 12, seed: firstSeed, count: 2_000 / divisor },
  { blocks: 48, seed: firstSeed + 2_000, count: 200 / divisor },
];

const commandLine = (...flags: string[]) => [testaot, "fuzz-allocation", ...flags].join(" ");

for (const { blocks, seed, count } of ranges) {
  const flags = [`--seed=${seed}`, `--count=${count}`, `--blocks=${blocks}`];
  test.skipIf(!!without("testaot"))(
    `procedures of ${blocks} blocks from the seeds ${seed} to ${seed + count - 1}`,
    async () => {
      console.error(`to run these seeds again: ${commandLine(...flags)}`);
      const { lines, stderr, exitCode } = await run("fuzz-allocation", ...flags);
      const failed = lines.filter(line => line.startsWith("FAIL "));
      // testaot names each seed before it builds from it, so a process that crashed named the culprit last.
      const culprits = new Set(
        [...failed, lines.at(-1) ?? ""].flatMap(line => /^(?:FAIL )?seed (\d+)/.exec(line)?.[1] ?? []),
      );
      for (const culprit of [...culprits].slice(0, 8))
        console.error(`to see what seed ${culprit} builds: ${commandLine(`--show=${culprit}`, `--blocks=${blocks}`)}`);
      expect({ failed: failed.slice(0, 20), lastLine: lines.at(-1), stderr, exitCode }).toEqual({
        failed: [],
        lastLine: `${count} passed, 0 failed, 0 todo`,
        stderr: expect.any(String),
        exitCode: 0,
      });
    },
    300_000,
  );
}
