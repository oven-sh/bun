// Fixed seeds of fuzz/functions-that-make-many-objects-and-return-one.ts: a function that makes many small objects and returns one of
// them builds, and its caller sees what it sees in plain Bun.
import { generate } from "./fuzz/functions-that-make-many-objects-and-return-one";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const tsconfig = JSON.stringify({
  compilerOptions: { target: "esnext", module: "preserve", moduleResolution: "bundler", noEmit: true, strict: true },
});

// Every run takes these, whatever else it takes.
const onceWrong = [3, 99, 107, 119, 147, 155, 170, 195, 203, 207, 221, 226, 263];

generated(
  "functions that make many objects and return one answer as in plain Bun",
  Array.from({ length: 320 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-limit=MaxSinkingRounds:1"] : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)), files: { "tsconfig.json": tsconfig } }),
  })),
);
