// Fixed seeds of fuzz/one-built-in-asked-at-two-places-that-do-different-things-with-its-answer.ts: small programs in which one built-in is asked at two places that have nothing else in common. The first
// looks closely at the answer; the second takes its own answer apart, stores to it or keeps it, which changes nothing about the first one's.
import { generate } from "./fuzz/one-built-in-asked-at-two-places-that-do-different-things-with-its-answer";
import { Random } from "./fuzz/random";
import { generated } from "./generated/run-generated";

generated(
  "one built-in asked at two places that do different things with its answer",
  Array.from({ length: 240 }, (_, index) => ({
    name: `seed ${index + 1}.`,
    // Every run takes the first twenty-four seeds; AOT_GENERATED=all takes all.
    isAlwaysRun: index < 24,
    isOnlyCompiled: true as const,
    // Nothing is put into the text: one more place that asks a built-in would be a third place.
    keepsItsText: true as const,
    make: () => generate(new Random(index + 1)),
  })),
);
