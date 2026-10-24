// Fixed seeds of fuzz/instances-below-built-in-classes-frozen-closed-and-redefined.ts: instances of classes below Map, Set, Array, Error and two dozen more built-in classes, with declared fields of
// their own, are frozen, sealed, closed, redefined and given another prototype in typed code, used again, and live through collections.
import { generate } from "./fuzz/instances-below-built-in-classes-frozen-closed-and-redefined";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = [
  981850000000120,
  981850000000136,
  981850000000195,
  981850000000204,
  ...Array.from({ length: 36 }, (_, index) => index + 1),
];

generated(
  "an instance below a built-in class answers as in plain Bun once it is frozen, closed or redefined",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    flags: [],
    alsoUnder: [{ BUN_JSC_slowPathAllocsBetweenGCs: "7", BUN_JSC_scribbleFreeCells: "1", BUN_JSC_useZombieMode: "1" }],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
