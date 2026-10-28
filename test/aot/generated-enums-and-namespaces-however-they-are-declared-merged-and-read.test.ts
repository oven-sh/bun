// Fixed seeds of fuzz/enums-and-namespaces-however-they-are-declared-merged-and-read.ts: enums and namespaces of every form, alone, in several declarations and beside functions, classes and enums
// of their names; their members are read by name, under keys and ahead of the declaration, and the objects are listed, written as JSON and changed.
import { generate } from "./fuzz/enums-and-namespaces-however-they-are-declared-merged-and-read";
import { Random } from "./fuzz/random";
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
  "enums and namespaces however they are declared, merged and read",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
