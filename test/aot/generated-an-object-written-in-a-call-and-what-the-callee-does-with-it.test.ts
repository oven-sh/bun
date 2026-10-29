// Fixed seeds of fuzz/an-object-written-in-a-call-and-what-the-callee-does-with-it.ts: small programs about one object or list that is written as an argument of a call, and one thing that the callee does
// with it beyond reading its members: it answers with it, keeps it, compares it, stores to it, lists it, hands it on, throws it. It is an object like any other.
import { generate } from "./fuzz/an-object-written-in-a-call-and-what-the-callee-does-with-it";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "an object written in a call and what the callee does with it",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more call of the function would be one more thing known about its parameter.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
