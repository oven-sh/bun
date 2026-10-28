// Fixed seeds of fuzz/commonjs-files-asked-for-while-they-run.ts: a CommonJS file is asked for again while it runs, by itself or by what it requires, and then throws or ends.
import { generate } from "./fuzz/commonjs-files-asked-for-while-they-run";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "CommonJS files asked for while they run",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes a quarter of these; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 100,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more job would change which step of a load a call meets.
    keepsItsText: true as const,
    // The reference transpiles on one thread: the texts are read in the order in which they are asked for. An executable reads nothing.
    plainEnv: { BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" },
    make: () => generate(new Random(index + 1)),
  })),
);
