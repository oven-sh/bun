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

// A validating build reads at start each object that holds a member it names, here the classes of Intl.
const inAnotherOrder = [67];

// Every run takes these, whatever else it takes.
const onceWrong = [
  3, 4, 13, 15, 19, 20, 22, 32, 43, 47, 56, 61, 62, 68, 69, 72, 77, 78, 84, 85, 88, 91, 94, 98, 99, 100, 101, 110, 112,
  114, 115, 116, 119, 123, 125, 129, 137, 139, 143, 146, 151, 154, 155, 163, 175, 183, 187, 223, 231,
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
