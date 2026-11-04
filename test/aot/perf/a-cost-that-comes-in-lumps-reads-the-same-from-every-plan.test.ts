// A pin went red and green by itself: ./measure-idioms.ts read 14,100 to 16,400 instructions a turn from one executable, depending on where its two runs ended among the lumps that follow a
// full collection. The program here is arithmetic, so much a turn and a lump every so many turns, so this needs no counter of the processor.
import { expect, test } from "bun:test";
import { timesThatEvenOutLumps } from "./measure-idioms";

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
        const times = evenedOut ? timesThatEvenOutLumps(part => run(program, firstInThePlan, part * (turns >> 6))) : 1;
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
