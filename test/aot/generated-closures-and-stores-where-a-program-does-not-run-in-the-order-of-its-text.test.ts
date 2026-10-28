// Fixed seeds of fuzz/closures-and-stores-where-a-program-does-not-run-in-the-order-of-its-text.ts: small programs about one variable, the closures that read it and the stores to it, written into the
// places of one statement whose parts run in another order than they are written in: patterns, heads of loops, classes, parameters, generators and what built-ins call. A closure sees every store that runs behind its making.
import { generate } from "./fuzz/closures-and-stores-where-a-program-does-not-run-in-the-order-of-its-text";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

const onceWrong = [73, 108, 146, 161, 162];

generated(
  "closures and stores where a program does not run in the order of its text",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more use of the variable would decide how it is kept.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
