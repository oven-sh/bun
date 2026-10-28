// Fixed seeds of fuzz/variables-that-never-took-their-class-are-constructed-called-and-extended.ts: a variable is meant to take a class, the store never runs,
// and the program constructs, calls and extends what the variable still holds. Every use gives what it gives in plain Bun.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/variables-that-never-took-their-class-are-constructed-called-and-extended";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong: number[] = [
  26, 34, 60, 74, 75, 79, 90, 108, 128, 143, 148, 170, 179, 201, 203, 210, 234, 248, 274, 289, 291, 297, 310, 324, 341,
  342, 343, 374, 388, 393,
];

generated(
  "variables that never took their class are constructed, called and extended as in plain Bun",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    exitsAsPlainBunDoes: true as const,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-validate"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
  })),
);
