// Fixed seeds of fuzz/text-beside-compiled-code.ts: text that becomes code at run time works on objects that compiled code made, and the other way round.
// Each executable also runs with a collection at every n-th allocation that leaves the fast path: shapes die between two runs of one piece of text.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/text-beside-compiled-code";
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

generated(
  "text that becomes code at run time works on objects that compiled code made",
  Array.from({ length: 24 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    isAlwaysRun: index % 3 === 0,
    isOnlyCompiled: true as const,
    alsoUnder: [
      { BUN_JSC_slowPathAllocsBetweenGCs: "11" },
      { BUN_JSC_slowPathAllocsBetweenGCs: "23" },
      { BUN_JSC_slowPathAllocsBetweenGCs: "7", BUN_JSC_useEdenCollectionsAtSlowPathAllocs: "1" },
    ],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
