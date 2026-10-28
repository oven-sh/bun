// Fixed seeds of fuzz/workers-that-work-within-a-limit-on-the-address-space.ts: the main thread starts Workers in waves and hands each a piece
// of work whose answer hangs on the work alone. The executable runs without a limit on the address space of the process and within several
// (ulimit -v, in kB): a Worker that starts answers as in plain Bun, and one that cannot be started is written down as refused.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/workers-that-work-within-a-limit-on-the-address-space";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

const GB = 1024 * 1024;

describe.concurrent("Workers of a compiled program answer within a limit on the address space as without one", () => {
  test.skipIf(!isLinux || isASAN).each(Array.from({ length: 12 }, (_, index) => index + 1))(
    "seed %d",
    async seed => {
      using folder = tempDir("aot-workers-limit-seeds", { "program.js": generate(new Random(seed)) });
      const env = { ...bunEnv, BUN_CRASH_REPORT_URL: "" };
      const plain = await runCommand([bunExe(), "program.js"], String(folder), env);
      expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
      const built = await runCommand(
        [bunExe(), "build", "--compile", "--aot", "program.js", "--outfile", "program"],
        String(folder),
        env,
      );
      expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
        stderr: expect.not.stringMatching(/^error\b/m),
        exitCode: 0,
      });
      const expected = plain.stdout.split("\n");
      for (const limit of [undefined, 4 * GB, 3 * GB, 2 * GB]) {
        const command = limit ? `ulimit -v ${limit} && exec ./program` : "exec ./program";
        const { stdout, stderr, exitCode } = await runCommand(["sh", "-c", command], String(folder), env);
        const lines = stdout.split("\n");
        const others = lines.filter((line, index) => line !== expected[index] && !(limit && line.endsWith("refused")));
        expect({ limit, stderr, exitCode, count: lines.length, others }).toEqual({
          limit,
          stderr: "",
          exitCode: 0,
          count: expected.length,
          others: [],
        });
      }
    },
    240_000,
  );
});
