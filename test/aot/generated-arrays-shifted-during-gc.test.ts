// Fixed seeds of fuzz/arrays-shifted-during-gc.ts: arrays that had elements inserted or removed at the front are read, written,
// swapped, sorted and resized while the program allocates enough garbage to keep the garbage collector running.
// Every second seed is TypeScript.
import { generate } from "./fuzz/arrays-shifted-during-gc";
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
    types: ["bun-types"],
  },
});

generated(
  "an array changed at the front works like any other array while the garbage collector runs",
  Array.from({ length: 80 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : [],
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.js",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
