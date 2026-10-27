// Fixed seeds of fuzz/values-of-another-kind-through-type-parameters.ts: a value that is not what the type argument says goes in through `any`, passes
// through the type parameter by a function, a method, a generic class, a container or a callback of an array method, and is kept in a constant, a
// variable that closures share, a field, an element or a parameter whose type says otherwise. Every use of it there gives what it gives in plain Bun.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/values-of-another-kind-through-type-parameters";
import { generated } from "./generated/run-generated";

// Every run takes these, whatever else it takes.
const onceWrong: number[] = [10, 56, 75, 101, 130, 136, 147, 205, 268, 300, 302, 311, 381];

generated(
  "values of another kind that passed through a type parameter are used as in plain Bun",
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
          : [],
    make: () => ({ file: "main.ts", text: generate(new Random(index + 1)) }),
  })),
);
