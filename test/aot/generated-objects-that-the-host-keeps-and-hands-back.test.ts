// Fixed seeds of fuzz/objects-that-the-host-keeps-and-hands-back.ts: a fresh object is handed to the host, which hands it to a callback that changes it, or writes into it itself, turns of the event loop later; then its maker reads it again.
// Each program is also built with every function hot.
import { generate } from "./fuzz/objects-that-the-host-keeps-and-hands-back";
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
  "the maker reads what the host has let others do",
  Array.from({ length: 120 }, (_, index) => ({
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
