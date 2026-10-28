// Fixed seeds of fuzz/what-a-suspended-function-finds-in-its-variables-when-it-goes-on.ts: small programs about one generator or async function, one variable of it and one closure that stores to that
// variable. The closure leaves the function by one road, whoever drives the function calls it while the function is suspended, and the function reads the variable when it goes on.
import { Random } from "./fuzz/random";
import { generate } from "./fuzz/what-a-suspended-function-finds-in-its-variables-when-it-goes-on";
import { generated } from "./generated/run-generated";

generated(
  "what a suspended function finds in its variables when it goes on",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more closure over the variable would be one more thing known about it.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
