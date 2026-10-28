// Fixed seeds of fuzz/elements-stored-below-an-object-that-intercepts-them.ts: lists, objects and instances take elements by index, and at some
// time an object above them begins to intercept such stores: a Proxy in the chain, a setter or a value that cannot be written under an index.
// Objects are made before and behind that time, collections run in between, and classes are made by the hundred.
import { generate } from "./fuzz/elements-stored-below-an-object-that-intercepts-them";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "elements stored below an object that intercepts them go where they go in plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    exitsAsPlainBunDoes: true as const,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-heat=everything-is-cold"] : [],
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
