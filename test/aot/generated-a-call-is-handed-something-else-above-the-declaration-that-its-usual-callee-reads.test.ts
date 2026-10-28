// Fixed seeds of fuzz/a-call-is-handed-something-else-above-the-declaration-that-its-usual-callee-reads.ts: small programs about one place that calls, constructs or asks a member of whatever it is handed:
// forty times a function, class or object of the program, and once, above the declaration that this one reads, something else that answers to the same use.
import { generate } from "./fuzz/a-call-is-handed-something-else-above-the-declaration-that-its-usual-callee-reads";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "a call is handed something else above the declaration that its usual callee reads",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    wasOnceWrong: false,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: what stands above the declaration is the point.
    keepsItsText: true as const,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
