// Linux on x86-64 polls in a loop by a load that faults while a stop is asked for. Every other platform tests a word and calls the
// run time, and that call once left the register that reports an exception as it found it: the loop spun on behind a termination,
// or the handler of exceptions ran with nothing thrown. The program is one of the corpus, of which a run takes a share. This file
// runs it on every platform, every time.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned, unsupported } from "./run-programs";

const program = join(
  import.meta.dir,
  "programs",
  "calls",
  "a-worker-is-terminated-inside-a-loop-that-calls-nothing.ts",
);

test.skipIf(!!unsupported)(
  "a Worker that spins in a compiled loop without calls is terminated",
  async () => {
    await slot(async () => {
      using dir = tempDir("aot-terminated-loop", {});
      const folder = String(dir);
      const executable = join(folder, isWindows ? "entry.exe" : "entry");
      built(await spawned([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], folder, bunEnv));
      const ran = await spawned([executable], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
      expect({ stdout: ran.stdout, stderr: ran.stderr, exitCode: ran.exitCode, signal: ran.signal }).toEqual({
        stdout: "a loop that ends: 45\nthe Worker: enters the loop\nthe Worker is closed\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      });
    });
  },
  240_000,
);
