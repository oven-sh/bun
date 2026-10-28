// Fixed seeds of fuzz/when-a-function-goes-on-behind-an-await-of-what-is-already-settled.ts: small programs about one async function, one thing that it awaits (a promise that is already settled, made
// odd in one way or not, a thenable, an instance of a class below `Promise`, a primitive), and a row of jobs beside it that tell the turns apart.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/when-a-function-goes-on-behind-an-await-of-what-is-already-settled";
import { generated } from "./generated/run-generated";

generated(
  "when a function goes on behind an await of what is already settled",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more job would move every turn.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
