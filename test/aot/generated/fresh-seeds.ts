// One program of each random generator under python/, from a seed that no earlier run has used. generated-by-python.test.ts runs the same
// seeds every time, so it only shows that what once worked still works. The first time that an old generator was given a new seed,
// it found that `{ ...o, 1: v }` made a broken object.
//
//   AOT_FRESH_SEEDS=1 bun test test/aot/generated-fresh-seeds            one new program of each generator
//   AOT_FRESH_SEED=2074312345 bun test test/aot/generated-fresh-seeds    the programs of that run again; the seed is in the name of each test
//   python3 test/aot/generated/python/<generator>.py <seed>              prints the program
//
// test/aot/fuzz/farm.py does the same without end, against several builds of Bun.
import { test } from "bun:test";
import { freshSeed } from "../fresh-seed";
import { generators, headingOf, program, python } from "./python-generators";
import { generated } from "./run-generated";

export function freshSeeds(part: number, parts: number) {
  if (!python) {
    console.error("SKIPPED: test/aot/generated-fresh-seeds: python3 is not installed");
    return void test.skip("python3 is not installed", () => {});
  }
  if (freshSeed === undefined) return void test.skip("no new seed was asked for: AOT_FRESH_SEEDS=1", () => {});
  generators
    .filter(([, , options = {}]) => !options.seeds && !options.noFreshSeeds)
    .filter((_, index) => index % parts === part - 1)
    .forEach(([name, extension, options = {}]) => {
      const title = headingOf(name, extension);
      generated(`${title.replaceAll("-", " ")}, a new seed`, [
        {
          name: `${title} ${freshSeed}`,
          isAlwaysRun: true,
          mayBeUnjudgeable: true,
          plainEnv: options.plainEnv,
          modeFailsToday: options.modeFailsToday && Object.values(options.modeFailsToday)[0],
          make: () => program(name, extension, options, freshSeed),
        },
      ]);
    });
}
