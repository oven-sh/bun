// Two threads hand each other a message, a port and an exit code, and which of them gets the processor first at each step goes
// by the load of the machine. The corpus runs the program once and sees one such order. This file runs it many times, several
// at once, so that it meets many orders: every run prints the same lines and ends. A run that does not end is killed at
// spawned()'s time limit and is listed with that signal and with what it had printed. The runs from source say whether an order
// that goes wrong is one of compiled code alone.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, unsupported } from "./run-programs";

const program = join(import.meta.dir, "programs", "library-modules", "a-worker-thread-and-message-channels.js");
const runs = isASAN || isDebug ? 48 : 200;
const atOnce = 12;
const everyRun = JSON.stringify({
  stdout:
    "moved away: 0\n" +
    "from the port: sum 16\n" +
    'from the worker: {"isMainThread":false,"hasId":true}\n' +
    "the worker ended with: 7 0\n" +
    '{"message":{"queued":1}} {"message":{"queued":2}} undefined\n' +
    "broadcast\n",
  stderr: "",
  exitCode: 0,
  signal: null,
});

/** How each run ended, and how many ended so. */
async function endings(cmd: string[], folder: string) {
  const counts: Record<string, number> = {};
  let started = 0;
  await Promise.all(
    Array.from({ length: atOnce }, async () => {
      while (started++ < runs) {
        const { stdout, stderr, exitCode, signal } = await spawned(cmd, folder, bunEnv);
        const ending = JSON.stringify({ stdout, stderr, exitCode, signal });
        counts[ending] = (counts[ending] ?? 0) + 1;
      }
    }),
  );
  return counts;
}

test.skipIf(!!unsupported)(
  `compiled ahead of time, ${runs} runs, ${atOnce} at once`,
  async () => {
    using dir = tempDir("aot-worker-ends-every-time", {});
    const folder = String(dir);
    const executable = join(folder, isWindows ? "entry.exe" : "entry");
    built(await spawned([bunExe(), "build", "--compile", "--aot", program, "--outfile", executable], folder, bunEnv));
    expect(await endings([executable], folder)).toEqual({ [everyRun]: runs });
  },
  480_000,
);

test(`from source, ${runs} runs, ${atOnce} at once`, async () => {
  using dir = tempDir("worker-ends-every-time", {});
  expect(await endings([bunExe(), "--no-install", program], String(dir))).toEqual({ [everyRun]: runs });
}, 480_000);
