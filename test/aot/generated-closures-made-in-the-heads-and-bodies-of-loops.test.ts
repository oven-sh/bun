// Fixed seeds of fuzz/closures-made-in-the-heads-and-bodies-of-loops.ts: loops whose variables are new on every turn, and closures made in the first part of the head, its test, its last part, the body
// and everything inside it. Each closure keeps the variables of the turn in which it was made. Behind the loop every closure is called, twice, in the order made and backwards.
import { generate } from "./fuzz/closures-made-in-the-heads-and-bodies-of-loops";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "closures made in the heads and bodies of loops",
  Array.from({ length: 120 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twelve seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 12,
    isOnlyCompiled: true as const,
    make: () => ({ file: "main.js", text: generate(new Random(index + 1)) }),
  })),
);
