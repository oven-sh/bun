// Fixed seeds of fuzz/host-functions-that-throw.ts: native functions return the same values and throw the same errors as in plain Bun,
// however they are called and whatever code of the program runs underneath them. Every second seed is TypeScript.
import { generate } from "./fuzz/host-functions-that-throw";
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

// With --aot-validate the stack of an error that a native function makes does not begin with that function.
const withoutTheFunction = [11, 15, 31, 67, 71, 87, 103, 127, 131, 147];

// Every run takes these, whatever else it takes.
const onceWrong = [
  1, 5, 6, 33, 45, 48, 49, 60, 61, 65, 77, 80, 86, 89, 98, 100, 114, 118, 124, 128, 141, 144, 149, 153, 158, 160,
];

generated(
  "host functions return and throw as in plain Bun",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    ...(withoutTheFunction.includes(index + 1) ? { failsToday: "the stack lacks the native function" } : {}),
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.mjs",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
