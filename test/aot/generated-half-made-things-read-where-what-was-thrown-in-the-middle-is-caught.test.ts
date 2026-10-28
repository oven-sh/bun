// Fixed seeds of fuzz/half-made-things-read-where-what-was-thrown-in-the-middle-is-caught.ts: small programs about one thing that is made in three steps, one of which throws, and a handler that reads
// what is there by then, by one road: the variable, a closure, what is thrown, `finally`, the caller. The steps ahead of the throw have happened, the steps behind it have not.
import { generate } from "./fuzz/half-made-things-read-where-what-was-thrown-in-the-middle-is-caught";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [169];

generated(
  "half-made things read where what was thrown in the middle is caught",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the thing would be one more road to it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
