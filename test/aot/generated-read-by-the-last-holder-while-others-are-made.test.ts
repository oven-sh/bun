// Fixed seeds of fuzz/read-by-the-last-holder-while-others-are-made.ts: a thing whose parts lie outside of it is read on every turn of a loop by the only one that still holds it,
// while the same turn makes other things. Each executable runs three times: by itself, and with a full and a young collection at every allocation that leaves the fast path,
// freed cells overwritten and never used again. Every second one of the small seeds is built so that every allocation leaves the fast path.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/read-by-the-last-holder-while-others-are-made";
import { generated } from "./generated/run-generated";

const collecting = {
  BUN_JSC_slowPathAllocsBetweenGCs: "1",
  BUN_JSC_scribbleFreeCells: "1",
  BUN_JSC_useZombieMode: "1",
};
const seeds: [seed: number, flags: string[]][] = [
  [981780000000198, ["--aot-disable=pass:InlineCalls"]],
  [981780000000316, []],
  [981780000000356, ["--aot-heat=everything-is-hot"]],
  ...Array.from({ length: 37 }, (_, index): [number, string[]] => [
    index + 1,
    index % 2 ? ["--aot-testing=ForceGCSlowPaths"] : [],
  ]),
];

generated(
  "what the last holder reads in a loop is what plain Bun reads, however often the collector runs",
  seeds.map(([seed, flags], index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 15,
    isOnlyCompiled: true as const,
    flags,
    alsoUnder: [collecting, { ...collecting, BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1" }],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
