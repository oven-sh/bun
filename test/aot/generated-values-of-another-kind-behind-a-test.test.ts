// Fixed seeds of fuzz/values-of-another-kind-behind-a-test.ts: a value that is not what the type says reaches a constant, a parameter, a variable, a field
// or an element of a primitive type through `any`. A switch, a comparison, typeof, instanceof, `in`, its truth, `?.` or `??` looks at it there, and what
// stands behind that test reads, stores, calls, adds, spreads or takes it apart. Every step gives what it gives in plain Bun.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/values-of-another-kind-behind-a-test";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong: number[] = [
  9, 12, 63, 85, 88, 99, 106, 110, 114, 116, 137, 142, 147, 150, 156, 253, 258, 261, 300, 310, 311, 314, 350, 360, 382,
  386,
];

generated(
  "values of another kind are used behind a test as in plain Bun",
  Array.from({ length: 400 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first sixteen seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 16,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    flags: onceWrong.includes(index + 1)
      ? []
      : index % 4 === 3
        ? ["--aot-validate"]
        : index % 4 === 2
          ? ["--aot-heat=everything-is-cold"]
          : index % 4 === 1
            ? ["--aot-heat=everything-is-hot"]
            : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
  })),
);
