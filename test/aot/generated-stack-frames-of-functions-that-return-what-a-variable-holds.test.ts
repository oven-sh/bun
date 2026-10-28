// Fixed seeds of fuzz/stack-frames-of-functions-that-return-what-a-variable-holds.ts: a chain of functions, each of which keeps the result of
// the next one in a variable and returns it in one of many ways. The last one writes down which of them are on the stack.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/stack-frames-of-functions-that-return-what-a-variable-holds";
import { generated } from "./generated/run-generated";

const listsOtherFrames: number[] = [
  4, 7, 9, 10, 16, 20, 26, 35, 40, 47, 48, 50, 53, 56, 60, 62, 65, 68, 69, 71, 80, 82, 83, 85, 86, 90, 103, 105, 110,
  119, 121, 122, 128, 133, 134, 140, 142, 144, 147, 154, 156, 157, 158, 160,
];

generated(
  "the stack lists the functions that plain Bun lists, however a function returns what a variable holds",
  Array.from({ length: 160 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    isOnlyCompiled: true as const,
    ...(listsOtherFrames.includes(index + 1)
      ? { linesDepartToday: "a caller is listed that plain Bun leaves out, or the other way round" }
      : {}),
    make: () =>
      index % 4 === 3
        ? { file: "main.ts", text: generate(new Random(index + 1), true) }
        : { file: "main.js", text: generate(new Random(index + 1)) },
  })),
);
