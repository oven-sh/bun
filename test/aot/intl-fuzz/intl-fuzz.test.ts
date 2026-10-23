// Formatters made from constants against ICU: see README.md. Each program makes over 600,000 comparisons.
//   AOT_INTL_FUZZ_PROGRAMS=<n>      how many programs with options drawn at random (default 3)
//   AOT_INTL_FUZZ_FIRST_SEED=<n>    the first seed (default 1); a failure names its seed
//   AOT_INTL_FUZZ_SWEEP_PARTS=<n>   how many parts of the sweep over every combination and locale (default 2 of over 9,000)
//   AOT_INTL_FUZZ_FIRST_PART=<n>    the first part (default 1234)
import { expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { test } from "../supported";
import {
  generateProgram,
  generateSweepProgram,
  generateTypicalProgram,
  numberOfSweepPrograms,
  numberOfTypicalPrograms,
  typicalFormattersWithoutAPattern,
} from "./generate";
import { buildAndRun } from "./sweep";

const programs = Number(process.env.AOT_INTL_FUZZ_PROGRAMS ?? 3);
const firstSeed = Number(process.env.AOT_INTL_FUZZ_FIRST_SEED ?? 1);
const parts = Number(process.env.AOT_INTL_FUZZ_SWEEP_PARTS ?? 2);
const firstPart = Number(process.env.AOT_INTL_FUZZ_FIRST_PART ?? 1234);

// TODO: the compiler makes no format patterns: a build lists none of the statistics ConstantFormatterRequests, FormatPatternsCreated and FormatPatternsRejectedByCheck, and ICU formats everything.
function agreesWithICU(name: string, generate: () => string, expectedWithoutAPattern?: number) {
  test.todo(
    `constant formatters agree with ICU, ${name}`,
    async () => {
      const { said, differences, refused, comparisons, formatters, withAPattern } = await buildAndRun(
        bunExe(),
        name,
        generate(),
        bunEnv,
      );
      expect({ said, differences, refused }).toEqual({ said: [], differences: 0, refused: 0 });
      expect(comparisons).toBeGreaterThan(100_000);
      if (expectedWithoutAPattern !== undefined) expect(formatters - withAPattern).toBe(expectedWithoutAPattern);
    },
    600_000,
  );
}

for (let seed = firstSeed; seed < firstSeed + programs; seed++)
  agreesWithICU(`seed ${seed}`, () => generateProgram(seed));
for (let part = firstPart; part < Math.min(firstPart + parts, numberOfSweepPrograms()); part++)
  agreesWithICU(`part ${part} of the sweep`, () => generateSweepProgram(part));
for (let part = 0; part < numberOfTypicalPrograms; part++)
  agreesWithICU(
    `part ${part} of what programs usually ask for`,
    () => generateTypicalProgram(part),
    typicalFormattersWithoutAPattern[part],
  );
