// Fixed seeds of fuzz/stack-frames-of-lists-made-by-their-length.ts: lists made by their length in the ways programs write it, with fill, map and
// other methods behind them, in every kind of place. The length is one that no list has, or a later call of the chain throws or takes a stack
// trace. The stack lists Array where plain Bun calls it, and not where its bytecode makes the list in the caller. Every fourth seed is TypeScript.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/stack-frames-of-lists-made-by-their-length";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong = [10, 19, 27, 40, 60, 68, 82, 83];

generated(
  "the stack of what a list made by its length throws lists the frames that plain Bun lists",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags:
      index % 4 === 1 ? ["--aot-heat=everything-is-cold"] : index % 4 === 2 ? ["--aot-heat=everything-is-hot"] : [],
    make: () =>
      index % 4 === 3
        ? { file: "main.ts", text: generate(new Random(index + 1), true) }
        : { file: "main.mjs", text: generate(new Random(index + 1)) },
  })),
);
