// Random programs in which what a site expects is wrong or out of date. Even seeds keep their types, odd seeds have none.
//
//   AOT_GENERATED=all bun test test/aot/generated-site-record-attacks                                              all 400 seeds
//   AOT_GENERATED_FLAGS="--aot-heat=everything-is-cold" bun test test/aot/generated-site-record-attacks            every function in the forms of cold code
//   bun test/aot/generated/site-record-attacks.ts <seed> [--js]                                                    prints a program
import { generated } from "./generated/run-generated";
import { siteRecordAttack } from "./generated/site-record-attacks";

generated(
  "what a site expects is wrong or out of date",
  Array.from({ length: 400 }, (_each, seed) => ({
    name: `seed ${seed}`,
    isAlwaysRun: seed < 24,
    isOnlyCompiled: true as const,
    make: () => siteRecordAttack(seed, seed % 2 === 0),
  })),
);
