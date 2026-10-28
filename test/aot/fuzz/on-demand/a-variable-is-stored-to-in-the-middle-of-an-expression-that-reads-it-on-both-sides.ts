// Fixed seeds of fuzz/a-variable-is-stored-to-in-the-middle-of-an-expression-that-reads-it-on-both-sides.ts: very small programs of one function, one variable and one expression with parts: a
// part in the middle stores to the variable, mostly a value of another kind, and the parts on both sides read it.
import { generate } from "../../fuzz/a-variable-is-stored-to-in-the-middle-of-an-expression-that-reads-it-on-both-sides";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [159];

generated(
  "a variable is stored to in the middle of an expression that reads it on both sides",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: the program is a few lines, and that nothing else stands in it is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
