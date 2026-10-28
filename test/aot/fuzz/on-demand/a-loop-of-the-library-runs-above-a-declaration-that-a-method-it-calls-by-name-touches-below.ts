// Fixed seeds of fuzz/a-loop-of-the-library-runs-above-a-declaration-that-a-method-it-calls-by-name-touches-below.ts: small programs in which a loop of the library that calls a member by its name
// runs at the top of a file on built-in objects, above a declaration that a member of the same name, of an object of the program further down, reads and stores to.
import { generate } from "../../fuzz/a-loop-of-the-library-runs-above-a-declaration-that-a-method-it-calls-by-name-touches-below";
import { Random } from "../../fuzz/random";
import { generated } from "../../generated/run-generated";

const onceWrong = [19, 89, 114, 157, 160, 177, 209];

generated(
  "a loop of the library runs above a declaration that a method it calls by name touches below",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: onceWrong.includes(index + 1),
    isOnlyCompiled: true as const,
    // Nothing is put into the text: what stands above the declaration is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
