// Runs alone: it judges by the memory that the machine has left.
import { expect } from "bun:test";
import { bunEnv, bunExe, isLinux } from "harness";
import { describeKill, heldTooMuchTogether } from "./harness/killed-for-memory";
import { availableMemory, endAtMemoryLimitTogether } from "./harness/memory-limit";
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
  "a command that is killed because the machine is short of memory is told so",
  async () => {
    const { watch } = endAtMemoryLimitTogether(8 * availableMemory());
    await using child = Bun.spawn({ cmd: [bunExe(), "-e", holds96MB, "60000"], env: bunEnv, stdout: "ignore" });
    using held = watch(child);
    await child.exited;
    expect({ exceeded: held.exceeded, signal: child.signalCode, held: held.held.replace(/[0-9]+/g, "N") }).toEqual({
      exceeded: true,
      signal: "SIGKILL",
      held: "it held N MB of the N MB that N processes held together, which may hold N MB; the machine had N MB left, and N MB have to stay free",
    });
  },
  30_000,
);

test("the error says first whose doing it was, within what the runner keeps of an error", () => {
  const held = "it held 9 MB of the 36 MB that 4 processes held together, which may hold 32 MB";
  expect(describeKill(held, ["bun", "a.js"])).toBe(
    `${heldTooMuchTogether}: ${held}. Run fewer of them at once: bun a.js`,
  );
  expect(describeKill(`${held}; the machine had 1 MB left, and 5 MB have to stay free`, ["bun"])).toStartWith(
    "KILLED: the machine had too little left: it held 9 MB",
  );
  expect(`error: ${heldTooMuchTogether}`.length).toBeLessThan(97);
});

test.skipIf(!isLinux)(
  "a command that holds less than the limit runs to its end",
  async () => {
    expect(await runAtOnce(1, 500)).toEqual([{ exceeded: false, signal: null }]);
  },
  30_000,
);
