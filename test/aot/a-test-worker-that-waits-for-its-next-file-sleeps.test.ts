// A worker of `bun test --parallel` that waits for its next file sleeps.
//
// The coordinator usually answers a worker at once. Where it does not, as while a file that took over a gigabyte runs and the next
// is such a file too, the worker waited by turning its event loop, and a loop that nothing holds polls without sleeping: each
// worker that waited took a core from the files that ran.
//
// Two workers are started as the coordinator starts them and are never sent a command. One lives three seconds longer than the
// other. Both pay the same to start, so the difference is what three seconds of waiting cost.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { test } from "./harness/default-timeout";

test.skipIf(isWindows)(
  "three more seconds of waiting cost next to nothing",
  async () => {
    using dir = tempDir("a-test-worker-that-waits-sleeps", { "a.test.js": `test("a", () => {});` });

    async function spentByWorkerThatWaits(milliseconds: number) {
      await using worker = Bun.spawn({
        cmd: [bunExe(), "test", "--test-worker", "--isolate"],
        env: bunEnv,
        cwd: String(dir),
        stdio: ["ignore", "ignore", "ignore", "pipe"],
      });
      await Bun.sleep(milliseconds);
      // It waits still: it has neither crashed nor given up.
      expect(worker.exitCode).toBeNull();
      worker.kill();
      await worker.exited;
      return Number(worker.resourceUsage()!.cpuTime.total) / 1000;
    }

    const [short, long] = await Promise.all([spentByWorkerThatWaits(3_000), spentByWorkerThatWaits(6_000)]);
    expect(long - short).toBeLessThan(750);
  },
  30_000,
);
