// Fixed seeds of fuzz/functions-capture-what-is-made-of-a-value-declared-as-another-type.ts: a value is declared as an interface that it may not fit, the program
// makes something of it, and a function captures what was made. Whoever reads it later reads what plain Bun reads.
import { generate } from "./fuzz/functions-capture-what-is-made-of-a-value-declared-as-another-type";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong: number[] = [100, 269, 385, 411, 487, 782, 1198, 1220, 1495, 1534, 1596, 2087, 2394];

generated(
  "functions capture what is made of a value declared as another type as in plain Bun",
  Array.from({ length: 2400 }, (_, index) => ({
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
