// Fixed seeds of fuzz/a-function-that-one-odd-road-calls-with-what-its-callers-never-hand-it.ts: small programs about one function whose written calls all hand it values of one kind, and one more call that
// comes by an odd road (a callback of a built-in, `call`, `apply`, `bind`, a tag, a list, another file) with another kind, another number of arguments or another `this`.
import { generate } from "./fuzz/a-function-that-one-odd-road-calls-with-what-its-callers-never-hand-it";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "a function that one odd road calls with what its callers never hand it",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more call of the function would be one more thing known about its parameters.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
