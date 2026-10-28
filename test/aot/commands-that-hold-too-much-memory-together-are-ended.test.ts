// Runs alone: it judges by the memory that the machine has left.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { endAtMemoryLimitTogether } from "./harness/memory-limit";
import { test } from "./supported";

const MB = 2 ** 20;
const holds96MB = `const held = Buffer.alloc(${96 * MB}, 1); setTimeout(() => console.log(held.length), Number(process.argv[1]));`;

async function runAtOnce(count: number, milliseconds: number) {
  const { watch } = endAtMemoryLimitTogether(320 * MB);
  return Promise.all(
    Array.from({ length: count }, async () => {
      await using child = Bun.spawn({
        cmd: [bunExe(), "-e", holds96MB, String(milliseconds)],
        env: bunEnv,
        stdout: "ignore",
        stderr: "inherit",
      });
      using held = watch(child);
      await child.exited;
      return { exceeded: held.exceeded, signal: child.signalCode };
    }),
  );
}

test.skipIf(!isLinux)(
  "commands that hold more than the limit together are killed, and each is told",
  async () => {
    expect(await runAtOnce(4, 60_000)).toEqual(Array(4).fill({ exceeded: true, signal: "SIGKILL" }));
  },
  30_000,
);

test.skipIf(!isLinux)(
  "a command that holds less than the limit runs to its end",
  async () => {
    expect(await runAtOnce(1, 500)).toEqual([{ exceeded: false, signal: null }]);
  },
  30_000,
);
