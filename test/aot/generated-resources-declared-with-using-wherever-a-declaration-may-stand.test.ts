// Fixed seeds of fuzz/resources-declared-with-using-wherever-a-declaration-may-stand.ts: `using` and `await using` over resources of every kind, in every place where a declaration may stand,
// left in every way. They print the order of everything, what is thrown with every `SuppressedError` taken apart, and how many jobs pass.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/resources-declared-with-using-wherever-a-declaration-may-stand";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "esnext",
    module: "preserve",
    moduleResolution: "bundler",
    noEmit: true,
    strict: true,
    types: [],
  },
});

generated(
  "resources declared with using wherever a declaration may stand",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
