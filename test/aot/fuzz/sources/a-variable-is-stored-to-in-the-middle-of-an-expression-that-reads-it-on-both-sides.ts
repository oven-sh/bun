// Fixed seeds of fuzz/a-variable-is-stored-to-in-the-middle-of-an-expression-that-reads-it-on-both-sides.ts: very small programs of one function, one variable and one expression with parts: a
// part in the middle stores to the variable, mostly a value of another kind, and the parts on both sides read it.
import { generate } from "../a-variable-is-stored-to-in-the-middle-of-an-expression-that-reads-it-on-both-sides";
import { Random } from "../random";
import { family } from "../family";

export default family(
  "a variable is stored to in the middle of an expression that reads it on both sides",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
