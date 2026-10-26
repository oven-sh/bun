// Fixed seeds of fuzz/keys-of-built-in-objects-after-reads-and-copies.ts: the own keys of a built-in object stand in the order they have
// in plain Bun, whatever the program read, added, deleted or copied before. Every second seed is TypeScript. From seed 161 on half of the
// steps read a member where nothing takes its value.
import { generate } from "./fuzz/keys-of-built-in-objects-after-reads-and-copies";
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

// A validating build reads every member it names at start.
const inAnotherOrder = [3, 15, 19, 43, 47, 67, 99, 119, 139, 155, 163, 175, 183, 187, 223, 231];

// Every run takes these, whatever else it takes.
const onceWrong = [
  4, 13, 20, 22, 32, 56, 61, 62, 68, 69, 72, 77, 78, 84, 85, 88, 91, 94, 98, 100, 101, 110, 112, 114, 115, 116, 123,
  125, 129, 137, 143, 146, 151, 154,
];

generated(
  "the keys of built-in objects stand in the order of plain Bun",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds of each kind; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16 || (index >= 160 && index < 176),
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    ...(inAnotherOrder.includes(index + 1) ? { failsToday: "a member that was used before stands further back" } : {}),
    make: () => ({
      file: (index + 1) % 2 === 1 ? "main.ts" : "main.mjs",
      text: generate(new Random(index + 1), (index + 1) % 2 === 1, index >= 160),
      files: { "tsconfig.json": tsconfig },
    }),
  })),
);
