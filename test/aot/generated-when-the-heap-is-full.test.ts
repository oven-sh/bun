// Fixed seeds of fuzz/when-the-heap-is-full.ts: objects of every kind kept alive until no more fit, the error caught at every level on the way up, a little given back and work done there.
// Each executable runs once with room for everything, where the program itself ends each fill, and once with 64 MB for its objects.
import { isASAN } from "harness";
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/when-the-heap-is-full";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    allowJs: true,
    noEmit: true,
    strict: true,
    types: [],
  },
});

// The last one found the range full where a class with private names is evaluated.
const seeds = [...Array.from({ length: 24 }, (_, index) => index + 1), 11792771444090];

generated(
  "work behind the error of a full heap",
  seeds.map((seed, index) => ({
    name: `seed ${seed}.`,
    isAlwaysRun: index % 4 === 0,
    isOnlyCompiled: true as const,
    mayStopOutOfMemory: true as const,
    // A Bun built with AddressSanitizer takes the range from another allocator, which does not hand out again at once what is freed.
    alsoUnder: isASAN ? [] : [{ BUN_JSC_markedBlockCageSizeInMB: "64" }],
    make: () => ({ file: "main.ts", text: generate(new Random(seed)), files: { "tsconfig.json": tsconfig } }),
  })),
);
