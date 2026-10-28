// Fixed seeds of fuzz/one-name-for-many-kinds-of-things.ts: one name holds something that can be called, a record without a class of its own and a thing with a fast form; it is used by element, by name, by call and by a walk.
// Each program is also built with every function hot.
import { generate } from "./fuzz/one-name-for-many-kinds-of-things";
import { Random } from "./fuzz/random";
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
  "a use of the name is right for each thing that it holds",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", every function hot." : "."}`,
    // Every run takes the first twenty seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 40,
    isOnlyCompiled: true as const,
    flags: index & 1 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
