// A reading of ./measure-idioms.ts is what a long run executes over a short one, divided by the turns between them. Compiled code takes a loop of over 2 ** 20 turns through a copy of it, all of its
// turns. With 4,000,000 turns planned, the short run took the loop and the long run the copy: a copy of 11 instructions a turn for the loop's 8 read 12.
// The program here is arithmetic, so this needs no counter of the processor.
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { fewestTurnsThatTakeTheCopy, mostTurnsOfLoopWithoutCopy, runsOfReading } from "./measure-idioms";

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
