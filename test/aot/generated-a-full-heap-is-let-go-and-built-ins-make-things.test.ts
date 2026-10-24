// Fixed seeds of fuzz/a-full-heap-is-let-go-and-built-ins-make-things.ts: objects are kept alive until no more fit, all of them or the older half are let go, and at once a built-in that makes things is called
// thousands of times. There is room again, so no call fails. Each executable runs once with room for everything, where the program itself ends each fill, and once with 64 MB for its objects.
import { isASAN } from "harness";
import { generate } from "./fuzz/a-full-heap-is-let-go-and-built-ins-make-things";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const seeds = Array.from({ length: 40 }, (_, index) => index + 1);
const staysFull = [22, 31];

generated(
  "built-ins make things behind a full heap that was let go",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index < 8,
    isOnlyCompiled: true as const,
    mayStopOutOfMemory: true as const,
    ...(staysFull.includes(seed) && {
      failsToday:
        "a word that a call left on the stack still names the list that was let go, the collector takes every word of the stack for a reference, and the range stays full",
    }),
    // A Bun built with AddressSanitizer takes the range from another allocator, which does not hand out again at once what is freed.
    alsoUnder: isASAN ? [] : [{ BUN_JSC_markedBlockCageSizeInMB: "64" }],
    make: () => ({
      file: "main.ts",
      text: generate(new Random(seed)),
      files: {},
    }),
  })),
);
