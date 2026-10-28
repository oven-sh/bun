// Fixed seeds of fuzz/strings-whose-storage-changes-width-behind-their-parts.ts: a string takes the storage of an equal property key, in the other width, and the parts
// that were cut from it before and the ropes that hold it are handed to every operator and built-in that needs their characters.
// Each program is also built as a very large program is.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/strings-whose-storage-changes-width-behind-their-parts";
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
  "a part of a string answers as a flat string does whatever has become of the storage",
  Array.from({ length: 48 }, (_, index) => ({
    name: `seed ${(index >> 1) + 1}${index & 1 ? ", as a very large program." : "."}`,
    isAlwaysRun: index % 6 < 2,
    isOnlyCompiled: true as const,
    // Every part answers as its flat twin does.
    written: { "wrong: ": "" },
    flags: index & 1 ? ["--aot-heat=everything-is-cold", "--aot-limit=MaxWarmCodeValues:1"] : [],
    make: () => ({
      file: "main.ts",
      text: generate(new Random((index >> 1) + 1)),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
