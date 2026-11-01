// With all the pins measured at once, ./measure-idioms.ts took 13 benchmarks of 1,252 for programs that wait, other ones each time: the busy machine had let the run of 5,000 turns end over two
// seconds later than the run of 1,000. A conversion of 17 instructions a turn got 16,000 turns for its 20 million, and a benchmark whose cost comes in lumps did not get the turns that even them out.
// The programs here are arithmetic, so this needs no counter of the processor.
import { expect } from "bun:test";
import { test } from "../harness/declare";
import { mostlyWaits, planOf } from "./measure-idioms";

type Program = {
  aTurn: number;
  secondsATurn: number;
  /** How often a turn gives up the processor. NaN where nothing counts that. */
  blocksATurn: number;
  lump?: { instructions: number; every: number };
};

/** Plans the program's measurement on a machine that keeps the first run, the second and so on from running for so many seconds. */
function planOn(heldUp: number[], { aTurn, secondsATurn, blocksATurn, lump }: Program) {
  let run = 0;
  return planOf(
    async ({ turns, warmUp }) => {
      const all = turns + 100 * warmUp;
      return {
        instructions: 60e6 + aTurn * all + (lump ? lump.instructions * Math.floor(all / lump.every) : 0),
        seconds: 0.04 + secondsATurn * all + (heldUp[run++] ?? 0),
        timesItGaveUpTheProcessor: 35 + Math.round(blocksATurn * all),
      };
    },
    { underTheJit: false },
  );
}

const busyMachines = [
  [0, 2.2],
  [0, 5],
  [0.3, 4.8, 1, 0, 7],
  [0, 60],
];

test.each(busyMachines)(
  "a conversion of 17 instructions a turn is repeated twenty million times, held up for %d and %d seconds",
  async (...heldUp) => {
    const conversion = { aTurn: 17, secondsATurn: 6e-9, blocksATurn: 0 };
    expect(await planOn([], conversion)).toEqual({ turns: 20e6, warmUp: 1 });
    expect(await planOn(heldUp, conversion)).toEqual({ turns: 20e6, warmUp: 1 });
  },
);

test.each(busyMachines)(
  "a cost that comes in lumps gets the turns that even it out, held up for %d and %d seconds",
  async (...heldUp) => {
    const dictionaries = { aTurn: 7000, secondsATurn: 3e-6, blocksATurn: 0, lump: { instructions: 80e6, every: 9000 } };
    const calm = await planOn([], dictionaries);
    expect(calm.turns).toBeGreaterThan(400_000);
    expect(await planOn(heldUp, dictionaries)).toEqual(calm);
  },
);

test("a collection on another thread now and then is no waiting", async () => {
  const allocates = { aTurn: 900, secondsATurn: 3e-7, blocksATurn: 0.004 };
  expect(await planOn([0, 3], allocates)).toEqual(await planOn([], allocates));
});

test("a timer in every turn: as many turns as take twenty seconds", async () => {
  expect((await planOn([], { aTurn: 3000, secondsATurn: 1.1e-3, blocksATurn: 1 })).turns).toBe(Math.round(20 / 1.1e-3));
  expect((await planOn([], { aTurn: 3000, secondsATurn: 1.1e-3, blocksATurn: 2.5 })).turns).toBe(
    Math.round(20 / 1.1e-3),
  );
});

test("a turn that blocks and is soon woken does not wait", async () => {
  expect((await planOn([], { aTurn: 8000, secondsATurn: 30e-6, blocksATurn: 1 })).turns).toBe(100_000);
});

test("where nothing counts how often a program gives up the processor, the clock decides", () => {
  const byTheClock = { aTurn: 3000, secondsATurn: 1.1e-3, timesATurnItGivesUpTheProcessor: NaN };
  expect(mostlyWaits(byTheClock)).toBe(true);
  expect(mostlyWaits({ ...byTheClock, secondsATurn: 4e-6 })).toBe(false);
});
