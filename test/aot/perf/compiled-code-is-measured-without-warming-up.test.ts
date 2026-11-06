// The plan of ./measure-idioms.ts for a measurement that runs nothing under the JIT. Arithmetic: it needs no counter of the processor.
import { expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import { turnsOfCallThatWarmsUp } from "./measure-idioms";

const calls = Number(
  /new Array\((\d+)\)\.fill\(/.exec(readFileSync(join(import.meta.dir, "idioms", "host.ts"), "utf8"))![1],
);
const plannedTurns = (aTurn: number) => Math.min(20e6, Math.max(8000, 800e6 / aTurn));
/** What one reading executes: a run of a quarter of the turns and a run of all of them, each behind its short calls. */
function reading(aTurn: number, underTheJit: boolean) {
  const warmUp = 2 * calls * turnsOfCallThatWarmsUp({ aTurn, waits: false, underTheJit }) * aTurn;
  return { warmUp, all: warmUp + 1.25 * plannedTurns(aTurn) * aTurn };
}

test("the program makes a hundred short calls", () => expect(calls).toBe(100));

test.each([4, 13, 400, 2000, 7000, 100_000, 3e6])("a turn of %d instructions, compiled", aTurn => {
  const { warmUp, all } = reading(aTurn, false);
  expect(warmUp / all).toBeLessThan(0.02);
});

test("a call never takes no turns: the program ends at the first call that does", () => {
  for (const underTheJit of [false, true])
    for (const waits of [false, true])
      for (const aTurn of [1, 2000, 1e9])
        expect(turnsOfCallThatWarmsUp({ aTurn, waits, underTheJit })).toBeGreaterThan(0);
});

test("under the JIT a call takes ten million instructions, and 100 to 5,000 turns", () => {
  expect(turnsOfCallThatWarmsUp({ aTurn: 13, waits: false, underTheJit: true })).toBe(5000);
  expect(turnsOfCallThatWarmsUp({ aTurn: 7000, waits: false, underTheJit: true })).toBe(1429);
  expect(turnsOfCallThatWarmsUp({ aTurn: 3e6, waits: false, underTheJit: true })).toBe(100);
  expect(turnsOfCallThatWarmsUp({ aTurn: 7000, waits: true, underTheJit: true })).toBe(100);
  expect(reading(7000, true).warmUp / reading(7000, true).all).toBeGreaterThan(0.6);
});
