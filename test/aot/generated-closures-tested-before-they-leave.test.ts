// Fixed seeds of fuzz/closures-tested-before-they-leave.ts: a closure that was asked something and then left its function is the same
// function under every name, as in plain Bun.
import { generate } from "./fuzz/closures-tested-before-they-leave";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [76, 116, 130];

generated(
  "closures that were tested before they left their function stay the same function",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags:
      index % 2 === 1
        ? ["--aot-limit=MaxOptimizationRounds:0"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-hot"]
          : [],
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
