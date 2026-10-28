// Fixed seeds of fuzz/effects-inside-expressions-whose-value-nobody-uses.ts: small programs of statements whose value nobody uses, with something inside each that happens all the same.
import { generate } from "./fuzz/effects-inside-expressions-whose-value-nobody-uses";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "effects inside expressions whose value nobody uses",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Every second is compiled as it is written.
    keepsItsText: index % 2 === 0 || undefined,
    // Every fourth is built so that it checks what the compiler took for granted.
    flags: index % 4 === 2 ? ["--aot-validate"] : [],
    make: () => generate(new Random(index + 1)),
  })),
);
