// The arithmetic of ./measure-idioms.ts, which plans the measurements of the bench. Nothing is built and nothing is counted: every program here is a formula.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  fewestTurnsThatTakeTheCopy,
  mostTurnsOfLoopWithoutCopy,
  mostlyWaits,
  planOf,
  runsOfReading,
  timesThatEvenOutLumps,
  turnsOfCallThatWarmsUp,
} from "./measure-idioms";

// With all the benchmarks measured at once, ./measure-idioms.ts took 13 benchmarks of 1,252 for programs that wait, other ones each time: the busy machine had let the run of 5,000 turns end over two
// seconds later than the run of 1,000. A conversion of 17 instructions a turn got 16,000 turns for its 20 million, and a benchmark whose cost comes in lumps did not get the turns that even them out.
// The programs here are arithmetic, so this needs no counter of the processor.
describe("a busy machine gives a measurement the same plan", () => {
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
    return planOf(async ({ turns, warmUp }) => {
      const all = turns + 100 * warmUp;
      return {
        instructions: 60e6 + aTurn * all + (lump ? lump.instructions * Math.floor(all / lump.every) : 0),
        seconds: 0.04 + secondsATurn * all + (heldUp[run++] ?? 0),
        timesItGaveUpTheProcessor: 35 + Math.round(blocksATurn * all),
      };
    });
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
      expect(await planOn([], conversion)).toEqual({ turns: 20e6, warmUp: 5000 });
      expect(await planOn(heldUp, conversion)).toEqual({ turns: 20e6, warmUp: 5000 });
    },
  );

  test.each(busyMachines)(
    "a cost that comes in lumps gets the turns that even it out, held up for %d and %d seconds",
    async (...heldUp) => {
      const dictionaries = {
        aTurn: 7000,
        secondsATurn: 3e-6,
        blocksATurn: 0,
        lump: { instructions: 80e6, every: 9000 },
      };
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
    expect((await planOn([], { aTurn: 3000, secondsATurn: 1.1e-3, blocksATurn: 1 })).turns).toBe(
      Math.round(20 / 1.1e-3),
    );
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
});

// A row moved by itself: ./measure-idioms.ts read 14,100 to 16,400 instructions a turn from one executable, depending on where its two runs ended among the lumps that follow a
// full collection. The program here is arithmetic, so much a turn and a lump every so many turns, so this needs no counter of the processor.
describe("a cost that comes in lumps reads the same from every plan", () => {
  type Program = { aTurn: number; lump: number; every: number };
  /** What a run of so many turns executes when the first lump falls `first` turns in. */
  const run = ({ aTurn, lump, every }: Program, first: number, turns: number) =>
    aTurn * turns + lump * Math.floor((turns + every - first) / every);
  const reading = (program: Program, first: number, turns: number) =>
    (run(program, first, turns) - run(program, first, turns >> 2)) / (turns - (turns >> 2));

  /** How far the reading lies from what a turn costs in the long run, at worst, over plans a few turns apart and lumps that begin anywhere. */
  function worstError(program: Program, evenedOut: boolean) {
    const inTheLongRun = program.aTurn + program.lump / program.every;
    const planned = Math.round(800e6 / inTheLongRun);
    let worst = 0;
    for (let turns = planned - 1000; turns <= planned + 1000; turns += 100)
      for (let first = 0; first < program.every; first += Math.ceil(program.every / 40))
        for (let firstInThePlan = 0; firstInThePlan < program.every; firstInThePlan += Math.ceil(program.every / 40)) {
          const times = evenedOut
            ? timesThatEvenOutLumps(part => run(program, firstInThePlan, part * (turns >> 6)))
            : 1;
          worst = Math.max(worst, Math.abs(reading(program, first, turns * times) / inTheLongRun - 1));
        }
    return worst;
  }

  test("a dictionary built anew in every turn, whose shapes a full collection lets go of", () => {
    const program = { aTurn: 7000, lump: 80e6, every: 9000 };
    expect(worstError(program, false)).toBeGreaterThan(0.08);
    expect(worstError(program, true)).toBeLessThan(0.015);
  });

  test.each([5, 6, 8, 11, 16, 23, 30])("%d lumps between the two runs that make a third of the cost", lumps => {
    // 600 million instructions between the two runs: 400 million of turns and 200 million of lumps.
    const program = { aTurn: 10_000, lump: 200e6 / lumps, every: Math.round(40_000 / lumps) };
    expect(worstError(program, false)).toBeGreaterThan(0.2 / lumps);
    expect(worstError(program, true)).toBeLessThan(0.015);
  });

  test("a collection that costs what a collection costs adds no turns", () => {
    const program = { aTurn: 100, lump: 2e6, every: 40_000 };
    for (let first = 0; first < program.every; first += 1000)
      expect(timesThatEvenOutLumps(part => run(program, first, part * 125_000))).toBe(1);
  });

  test("a cost that rises with the turns is no lump", () => {
    // A number that is printed has a digit more from the millionth turn on.
    expect(timesThatEvenOutLumps(part => 100 * part * 125_000 + 5 * Math.max(0, part * 125_000 - 1e6))).toBe(1);
  });
});

// A reading of ./measure-idioms.ts is what a long run executes over a short one, divided by the turns between them. Under a compiler that takes a loop of over 2 ** 20 turns through a copy of it, all
// of its turns, a quarter of 4,000,000 turns takes the loop and all of them take the copy: a copy of 11 instructions a turn for the loop's 8 would read 12. So both runs lie on one side.
// The program here is arithmetic, so this needs no counter of the processor.
describe("both runs of a reading take the same loop", () => {
  /** `inFront` turns stand in front of the loop, each at the price of a turn of the loop. The copy is for over 2 ** 20 turns that are left. */
  type Program = { start: number; inFront: number; inTheLoop: number; inTheCopy: number };
  const takesTheCopy = ({ inFront }: Program, turns: number) => turns - inFront > mostTurnsOfLoopWithoutCopy;
  const run = (program: Program, turns: number) =>
    program.start +
    Math.min(turns, program.inFront) * program.inTheLoop +
    Math.max(0, turns - program.inFront) * (takesTheCopy(program, turns) ? program.inTheCopy : program.inTheLoop);
  function reading(program: Program, turns: number) {
    const { short, long } = runsOfReading(turns);
    return (run(program, long) - run(program, short)) / (long - short);
  }

  const pinned: number[] = Object.values(JSON.parse(readFileSync(join(import.meta.dir, "turns.json"), "utf8")));
  const most = mostTurnsOfLoopWithoutCopy;
  const aroundTheSteps = [most, 2 * most, 4 * most, 4 * fewestTurnsThatTakeTheCopy].flatMap(step =>
    [-5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5].map(by => step + by),
  );
  // What planOf() plans for turns of 40 to 100,000 instructions.
  const planned = Array.from({ length: 400 }, (_, step) => Math.round(800e6 / (40 * 1.02 ** step)));
  const plans = [...new Set([...pinned, ...aroundTheSteps, ...planned, 8000, 20e6])];

  test("some plans have a quarter of their turns in the loop and all of them in the copy", () => {
    expect(plans.filter(turns => turns > most && turns >> 2 <= most).length).toBeGreaterThan(50);
    expect(pinned).toContain(4_000_000);
  });

  test.each([
    { start: 17e6, inFront: 0, inTheLoop: 8, inTheCopy: 11 },
    { start: 17e6, inFront: 1, inTheLoop: 8, inTheCopy: 11 },
    { start: 17e6, inFront: 8, inTheLoop: 13, inTheCopy: 14 },
    { start: 17e6, inFront: 0, inTheLoop: 400, inTheCopy: 399 },
  ])(
    "$inFront turns in front of a loop of $inTheLoop instructions a turn and a copy of $inTheCopy read one or the other",
    program => {
      for (const turns of plans) {
        const { long } = runsOfReading(turns);
        expect({ turns, reads: reading(program, turns) }).toEqual({
          turns,
          reads: takesTheCopy(program, long) ? program.inTheCopy : program.inTheLoop,
        });
      }
    },
  );

  test("a plan that lies on one side is a quarter of the turns against all of them", () => {
    expect(runsOfReading(8000)).toEqual({ short: 2000, long: 8000 });
    expect(runsOfReading(1_000_000)).toEqual({ short: 250_000, long: 1_000_000 });
    expect(runsOfReading(most)).toEqual({ short: most / 4, long: most });
    expect(runsOfReading(4 * fewestTurnsThatTakeTheCopy)).toEqual({
      short: fewestTurnsThatTakeTheCopy,
      long: 4 * fewestTurnsThatTakeTheCopy,
    });
    expect(runsOfReading(20e6)).toEqual({ short: 5e6, long: 20e6 });
  });

  test("the runs stay within the turns that were planned, and far enough apart", () => {
    for (const turns of plans) {
      const { short, long } = runsOfReading(turns);
      expect(short).toBeGreaterThanOrEqual(turns >> 2);
      expect(long).toBeLessThanOrEqual(turns);
      // What holds more the longer it runs shows between the two runs.
      expect(short / long).toBeLessThan(0.51);
      expect((long - short) / (turns - (turns >> 2))).toBeGreaterThan(0.33);
    }
  });
});

// The short calls in front of a run of ./measure-idioms.ts. Arithmetic: it needs no counter of the processor.
describe("the JIT is warmed up in front of what is measured", () => {
  const calls = Number(
    /new Array\((\d+)\)\.fill\(/.exec(readFileSync(join(import.meta.dir, "idioms", "host.ts"), "utf8"))![1],
  );
  const plannedTurns = (aTurn: number) => Math.min(20e6, Math.max(8000, 800e6 / aTurn));
  /** What one reading executes: a run of a quarter of the turns and a run of all of them, each behind its short calls. */
  function reading(aTurn: number) {
    const warmUp = 2 * calls * turnsOfCallThatWarmsUp({ aTurn, waits: false }) * aTurn;
    return { warmUp, all: warmUp + 1.25 * plannedTurns(aTurn) * aTurn };
  }

  test("the program makes a hundred short calls", () => expect(calls).toBe(100));

  test("a call never takes no turns: the program ends at the first call that does", () => {
    for (const waits of [false, true])
      for (const aTurn of [1, 2000, 1e9]) expect(turnsOfCallThatWarmsUp({ aTurn, waits })).toBeGreaterThan(0);
  });

  test("a call takes ten million instructions, and 100 to 5,000 turns", () => {
    expect(turnsOfCallThatWarmsUp({ aTurn: 13, waits: false })).toBe(5000);
    expect(turnsOfCallThatWarmsUp({ aTurn: 7000, waits: false })).toBe(1429);
    expect(turnsOfCallThatWarmsUp({ aTurn: 3e6, waits: false })).toBe(100);
    expect(turnsOfCallThatWarmsUp({ aTurn: 7000, waits: true })).toBe(100);
    expect(reading(7000).warmUp / reading(7000).all).toBeGreaterThan(0.6);
  });
});
