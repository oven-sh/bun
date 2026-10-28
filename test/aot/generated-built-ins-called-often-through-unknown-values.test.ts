// Fixed seeds of fuzz/built-ins-called-often-through-unknown-values.ts: one to five built-ins in one program, each called 1 to 400 times
// through a value the compiler cannot follow, with a change in the middle: another function in that value, a member or a prototype of
// the receiver's own, a frozen operand, a collection.
import { generate } from "./fuzz/built-ins-called-often-through-unknown-values";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "a built-in does the same however often and however it is reached",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    flags: index % 4 === 3 ? ["--aot-heat=everything-is-hot"] : index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => ({ file: "main.mjs", text: generate(new Random(index + 1)) }),
  })),
);
